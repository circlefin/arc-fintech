/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { IconCreditCard, IconLoader, IconPlus } from "@tabler/icons-react"
import { useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"
import { createOnrampKit, parseOnrampSession, type OnrampSession } from "@circle-fin/onramp-kit"
import * as z from "zod"

import { ONRAMP_WIDGET_BASE_URL } from "@/lib/circle/onramp-environment"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { WalletSelect, type WalletOption } from "@/components/wallet-select"

const addFundsFormSchema = z.object({
  walletAddress: z.string({
    error: "Please select a wallet.",
  }).min(1, "Please select a wallet"),
})

type AddFundsFormValues = z.infer<typeof addFundsFormSchema>

async function mintOnrampSession(walletId: string): Promise<OnrampSession> {
  const res = await fetch("/api/onramp/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletId }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Failed to start onramp session (${res.status})`)
  }

  return parseOnrampSession(await res.json())
}

interface AddFundsDialogProps {
  /** Preselected destination wallet, e.g. when launched from a specific wallet's row/card. */
  wallet?: { id: string; address: string; blockchain: string; name: string }
  /** Custom trigger element. Defaults to the standalone outline "Add Funds" button. */
  trigger?: React.ReactNode
}

export function AddFundsDialog({ wallet, trigger }: AddFundsDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [selectedWallet, setSelectedWallet] = React.useState<WalletOption | null>(null)

  // Onramp session, pre-minted ahead of the click so `openWindow()` can be
  // called synchronously inside the button's click handler — any `await`
  // before it makes the browser drop the user-gesture association and block
  // the popup. Paired with the wallet id it was minted for (rather than
  // reset directly in the effect below) so switching wallets can't leave a
  // stale, mismatched session looking "ready".
  const [mintedSession, setMintedSession] = React.useState<{ walletId: string; session: OnrampSession } | null>(null)
  const [mintErrorWalletId, setMintErrorWalletId] = React.useState<string | null>(null)

  const form = useForm<AddFundsFormValues>({
    resolver: zodResolver(addFundsFormSchema),
    defaultValues: {
      walletAddress: wallet ? `${wallet.address}-${wallet.blockchain}` : "",
    },
  })

  const walletAddress = useWatch({ control: form.control, name: "walletAddress" })

  const session = mintedSession && mintedSession.walletId === selectedWallet?.id ? mintedSession.session : null
  const status: "idle" | "loading" | "ready" | "error" =
    !selectedWallet
      ? "idle"
      : session
        ? "ready"
        : mintErrorWalletId === selectedWallet.id
          ? "error"
          : "loading"

  // Dialog open/close is a user-driven event, not something to synchronize
  // via an effect, so the reset lives in the onOpenChange handler itself.
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) return

    form.reset({
      walletAddress: wallet ? `${wallet.address}-${wallet.blockchain}` : "",
    })
    setSelectedWallet(
      wallet ? { id: wallet.id, address: wallet.address, blockchain: wallet.blockchain, name: wallet.name, circle_wallet_id: "" } : null
    )
    setMintedSession(null)
    setMintErrorWalletId(null)
  }

  // Mint (or re-mint) an onramp session whenever the dialog is open with a
  // wallet selected. Sessions are single-use and tied to one wallet, so a
  // wallet change needs a fresh one before the buy button is usable.
  React.useEffect(() => {
    if (!open || !selectedWallet?.id) return

    let cancelled = false
    const walletId = selectedWallet.id

    mintOnrampSession(walletId)
      .then((minted) => {
        if (!cancelled) setMintedSession({ walletId, session: minted })
      })
      .catch((error) => {
        console.error("Failed to start onramp session:", error)
        if (!cancelled) setMintErrorWalletId(walletId)
      })

    return () => {
      cancelled = true
    }
  }, [open, selectedWallet?.id])

  const handleOpenWidget = () => {
    if (!session || !selectedWallet) return
    const walletId = selectedWallet.id

    const onramp = createOnrampKit({
      // Must match the origin the server minted the session against. The
      // session route refuses to mint unless both resolve to sandbox, so by
      // the time there is a session to open, this is the sandbox widget.
      widgetBaseUrl: ONRAMP_WIDGET_BASE_URL,
    })

    // Nothing async above this line — the click gesture is still live here.
    const result = onramp.openWindow({
      session,
      onDepositSettled: ({ payload }) => {
        toast.success(
          `Deposit settled${payload.amount ? `: ${payload.amount} ${payload.tokenSymbol ?? ""}`.trim() : ""}`
        )
      },
      onSessionExpired: () => {
        mintOnrampSession(walletId)
          .then((refreshed) => setMintedSession({ walletId, session: refreshed }))
          .catch((error) => console.error("Failed to refresh expired onramp session:", error))
      },
    })

    if (result.status === "blocked") {
      if (result.reason === "popup_blocked") {
        toast.error(result.errorMessage || "Popup blocked — allow popups for this site and try again.")
      } else {
        // in_app_browser / pwa_standalone: no popup is usable here at all.
        toast.error("Buy Crypto isn't supported in this browser context. Open this page in a regular browser tab.")
      }
      return
    }

    // Browser events are a UI hint only — a closed tab means no SETTLED event
    // ever arrives, so they can't be the record of truth (that's the
    // onramp.deposit.settled webhook, applied server-side). Logged here so a
    // purchase is traceable in the console while that webhook path is
    // unverified against a real delivery.
    result.widget.on("*", (envelope) => {
      console.log("onramp", envelope.event, envelope.payload)
    })

    // Hand off to the popup and close our launcher dialog — the popup keeps
    // running independently of this component from here on.
    setOpen(false)

    // Sessions are single-use; pre-fetch a replacement for the next click.
    mintOnrampSession(walletId)
      .then((minted) => setMintedSession({ walletId, session: minted }))
      .catch((error) => console.error("Failed to pre-fetch replacement onramp session:", error))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline">
            <IconPlus className="size-4" />
            Add Funds
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Funds</DialogTitle>
          <DialogDescription>
            Buy crypto with fiat and settle it directly to a wallet.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <div className="grid gap-4 py-4 pb-0">

            {/* Reusable Wallet Selection Component */}
            <FormField
              control={form.control}
              name="walletAddress"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Destination Wallet</FormLabel>
                  <FormControl>
                    <WalletSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      onSelectWallet={(w) => {
                        field.onChange(`${w.address}-${w.blockchain}`)
                        setSelectedWallet(w)
                      }}
                      excludeGatewaySigner
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" type="button">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                onClick={handleOpenWidget}
                disabled={!walletAddress || status !== "ready"}
              >
                {status === "loading" ? (
                  <IconLoader className="size-4 animate-spin" />
                ) : (
                  <IconCreditCard className="size-4" />
                )}
                Buy Crypto
              </Button>
            </DialogFooter>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
