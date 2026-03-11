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

import { IconCheck, IconCopy } from "@tabler/icons-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

export type CreatedWalletData = {
  name: string
  chain: string
  circleWalletId: string
  address: string
}

interface WalletCreatedDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: CreatedWalletData | null
}

export function WalletCreatedDialog({
  open,
  onOpenChange,
  data,
}: WalletCreatedDialogProps) {
  // Safe accessors to ensure the DOM always renders valid strings
  const name = data?.name || ""
  const chain = data?.chain || ""
  const walletId = data?.circleWalletId || ""
  const address = data?.address || ""

  const copyWalletIdToClipboard = () => {
    if (walletId) {
      navigator.clipboard.writeText(walletId)
      toast.success("Wallet ID copied to clipboard")
    }
  }

  const copyAddressToClipboard = () => {
    if (address) {
      navigator.clipboard.writeText(address)
      toast.success("Wallet address copied to clipboard")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="bg-green-100 text-green-600 flex size-8 items-center justify-center rounded-full">
              <IconCheck className="size-5" />
            </div>
            Wallet Created Successfully
          </DialogTitle>
          <DialogDescription>
            Your new wallet is ready for use.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Name</Label>
              <p className="font-medium min-h-[20px]">{name}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Chain</Label>
              <p className="font-medium min-h-[20px]">{chain}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">
              Circle Wallet ID
            </Label>
            <div className="flex items-center gap-2">
              <div className="bg-muted text-muted-foreground flex-1 rounded-md border px-3 py-2 font-mono text-sm min-h-[38px]">
                {walletId}
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={copyWalletIdToClipboard}
                disabled={!walletId}
              >
                <IconCopy className="size-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">
              Wallet Address
            </Label>
            <div className="flex items-center gap-2">
              <div className="bg-muted text-muted-foreground flex-1 rounded-md border px-3 py-2 font-mono text-sm min-h-[38px]">
                {address}
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={copyAddressToClipboard}
                disabled={!address}
              >
                <IconCopy className="size-4" />
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            className="w-full sm:w-auto"
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
