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

import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { IconLoader, IconPlus } from "@tabler/icons-react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import * as z from "zod"

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
import { Input } from "@/components/ui/input"
import { WalletSelect } from "@/components/wallet-select"

// Form Schema Validation
const depositFormSchema = z.object({
  walletAddress: z.string({
    error: "Please select a wallet.",
  }).min(1, "Please select a wallet"),
  amount: z.string().refine(
    (val) => !isNaN(Number(val)) && Number(val) > 0,
    { message: "Amount must be a positive number." }
  ),
})

type DepositFormValues = z.infer<typeof depositFormSchema>

export function AddFundsDialog() {
  const [open, setOpen] = useState(false)
  const [selectedWalletAddress, setSelectedWalletAddress] = useState("")
  const [selectedBlockchain, setSelectedBlockchain] = useState("")

  const form = useForm<DepositFormValues>({
    resolver: zodResolver(depositFormSchema),
    defaultValues: {
      walletAddress: "",
      amount: "",
    },
  })

  // Watch fields to disable button if empty
  const walletAddress = form.watch("walletAddress")
  const amount = form.watch("amount")

  const { isSubmitting } = form.formState

  const onSubmit = async (values: DepositFormValues) => {
    try {
      // Extract the blockchain from the composite value if not already stored
      const actualAddress = selectedWalletAddress || values.walletAddress.split('-').slice(0, -2).join('-')
      const actualBlockchain = selectedBlockchain || values.walletAddress.split('-').slice(-2).join('-')
      
      const response = await fetch("/api/gateway/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: actualAddress,
          blockchain: actualBlockchain,
          amount: values.amount,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to deposit funds")
      }

      toast.success("Deposit initiated successfully", {
        description: `Transaction Hash: ${data.txHash?.slice(0, 10)}...`,
      })

      setOpen(false)
      form.reset()

    } catch (error) {
      console.error(error)
      toast.error("Deposit failed", {
        description: error instanceof Error ? error.message : "An unknown error occurred",
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <IconPlus className="mr-2 size-4" />
          Add funds
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add funds</DialogTitle>
          <DialogDescription>
            Deposit USDC into your balance via Circle Gateway.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-4 pb-0">

            {/* Reusable Wallet Selection Component */}
            <FormField
              control={form.control}
              name="walletAddress"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Source Wallet</FormLabel>
                  <FormControl>
                    <WalletSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      onSelectWallet={(wallet) => {
                        // Store the composite value for the select component
                        field.onChange(`${wallet.address}-${wallet.blockchain}`)
                        // Store the actual address and blockchain for API calls
                        setSelectedWalletAddress(wallet.address)
                        setSelectedBlockchain(wallet.blockchain)
                      }}
                      disabled={isSubmitting}
                      excludeGatewaySigner
                      minBalance={0}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Amount Input */}
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount (USDC)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="100.00"
                      disabled={isSubmitting}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" type="button" disabled={isSubmitting}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="submit"
                disabled={isSubmitting || !walletAddress || !amount}
              >
                {isSubmitting && <IconLoader className="size-4 animate-spin" />}
                Confirm Deposit
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
