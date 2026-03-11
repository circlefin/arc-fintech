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
import { IconLoader } from "@tabler/icons-react"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useForm } from "react-hook-form"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { createClient } from "@/lib/supabase/client"
import { WalletCreatedDialog, type CreatedWalletData } from "@/components/wallet-created-dialog"

const walletCreationFormSchema = z.object({
  name: z.string().min(2, {
    message: "Wallet name must be at least 2 characters.",
  }),
  chain: z.enum([
    "ARC-TESTNET",
    "AVAX-FUJI",
    "BASE-SEPOLIA",
    "ETH-SEPOLIA",
  ]),
  type: z.enum([
    "treasury",
    "payout",
    "customer"
  ])
})

interface NewWalletDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function NewWalletDialog({
  open,
  onOpenChange
}: NewWalletDialogProps) {
  const [successOpen, setSuccessOpen] = React.useState(false)
  const [createdWallet, setCreatedWallet] = React.useState<CreatedWalletData | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)

  const supabase = createClient()

  const walletCreationForm = useForm<z.infer<typeof walletCreationFormSchema>>({
    resolver: zodResolver(walletCreationFormSchema),
    defaultValues: {
      name: "",
      chain: "ARC-TESTNET",
      type: "treasury"
    },
  })

  // Watch fields to disable button if empty
  const name = walletCreationForm.watch("name")
  const chain = walletCreationForm.watch("chain")
  const type = walletCreationForm.watch("type")

  // This effect listens for changes in the 'open' prop.
  // Whenever the dialog closes (open becomes false), we reset the form.
  React.useEffect(() => {
    if (!open) {
      walletCreationForm.reset()
    }
  }, [open, walletCreationForm])

  const onSubmit = async (values: z.infer<typeof walletCreationFormSchema>) => {
    setIsLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("User not authenticated")

      // Create Wallet Set
      const setResponse = await fetch("/api/wallet-set", {
        method: "POST",
        body: JSON.stringify({ entityName: values.name }),
      })

      if (!setResponse.ok) throw new Error("Failed to create wallet set")
      const walletSet = await setResponse.json()

      // Create Wallet
      const walletResponse = await fetch("/api/wallet", {
        method: "POST",
        body: JSON.stringify({
          walletSetId: walletSet.id,
          blockchain: values.chain
        }),
      })

      if (!walletResponse.ok) throw new Error("Failed to create wallet")
      const wallet = await walletResponse.json()

      // Save to Supabase
      const { error: dbError } = await supabase.from("wallets").insert({
        user_id: user.id,
        name: values.name,
        circle_wallet_id: wallet.id,
        address: wallet.address,
        blockchain: values.chain,
        type: values.type,
      })

      if (dbError) throw dbError

      setCreatedWallet({
        name: values.name,
        chain: values.chain,
        circleWalletId: wallet.id,
        address: wallet.address,
      })

      // Close form
      onOpenChange(false)

      // Open success dialog
      setTimeout(() => {
        setSuccessOpen(true)
      }, 150)

    } catch (error) {
      console.error(error)
      toast.error("Something went wrong. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create new wallet</DialogTitle>
            <DialogDescription>
              Create a new developer-controlled Circle wallet.
            </DialogDescription>
          </DialogHeader>

          <Form {...walletCreationForm}>
            <form onSubmit={walletCreationForm.handleSubmit(onSubmit)} className="grid gap-4 py-4 pb-0">
              <FormField
                control={walletCreationForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Primary wallet" {...field} disabled={isLoading} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={walletCreationForm.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isLoading}>
                        <FormControl className="w-full">
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="treasury">Treasury</SelectItem>
                          <SelectItem value="payout">Payout</SelectItem>
                          <SelectItem value="customer">Customer</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={walletCreationForm.control}
                  name="chain"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Chain</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isLoading}>
                        <FormControl className="w-full">
                          <SelectTrigger>
                            <SelectValue placeholder="Select chain" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="ARC-TESTNET">Arc Testnet</SelectItem>
                          <SelectItem value="AVAX-FUJI">Avalanche Fuji</SelectItem>
                          <SelectItem value="BASE-SEPOLIA">Base Sepolia</SelectItem>
                          <SelectItem value="ETH-SEPOLIA">Ethereum Sepolia</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={isLoading}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isLoading || !name || !chain || !type}
                >
                  {isLoading && <IconLoader className="size-4 animate-spin" />}
                  Confirm
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <WalletCreatedDialog
        open={successOpen}
        onOpenChange={setSuccessOpen}
        data={createdWallet}
      />
    </>
  )
}
