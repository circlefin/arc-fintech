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

"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { IconLoader2 } from "@tabler/icons-react";

type PendingTransaction = {
  id: string;
  tx_hash: string;
  status: string;
  type: string;
  blockchain: string;
};

import { useMemo } from "react";

export function BridgeMonitor() {
  const [pendingTxs, setPendingTxs] = useState<PendingTransaction[]>([]);
  // Use useMemo to ensure supabase client instance remains stable across renders
  // to prevent unnecessary effect re-execution
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    const checkPendingTransactions = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Find transactions that are in PENDING state
      // Bridge Kit handles automatic forwarding, so we just monitor status changes
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("user_id", user.id)
        .eq("type", "REBALANCE")
        .eq("status", "PENDING");

      if (error) {
        console.error("Error fetching pending bridge transactions:", error);
        return;
      }

      if (data && data.length > 0) {
        setPendingTxs(data);
        
        // Monitor each pending transaction
        for (const tx of data) {
          if (!tx.tx_hash) continue;
          
          try {
            // Check status using the monitor endpoint
            const response = await fetch(`/api/bridge/monitor?txHash=${tx.tx_hash}`);
            const result = await response.json();

            if (response.ok && result.success) {
              // Check if status has changed to COMPLETE
              if (result.transaction.status === "COMPLETE") {
                toast.success("Bridge transfer completed!", {
                  description: `USDC successfully transferred on destination chain for transaction ${tx.tx_hash.slice(0, 6)}...`,
                });
              } else if (result.transaction.status === "FAILED") {
                toast.error("Bridge transfer failed", {
                  description: `Transaction ${tx.tx_hash.slice(0, 6)}... could not be completed.`,
                });
              }
              // If still PENDING, continue monitoring silently
            }
          } catch (err) {
            console.error(`Error monitoring bridge ${tx.tx_hash}:`, err);
          }
        }
      } else {
        setPendingTxs([]);
      }
    };

    // Check immediately on mount
    checkPendingTransactions();

    // Then poll every 30 seconds
    const interval = setInterval(checkPendingTransactions, 30000);

    return () => clearInterval(interval);
  }, [supabase]);

  if (pendingTxs.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-background border rounded-lg shadow-lg p-4 max-w-sm animate-in slide-in-from-bottom-5">
      <div className="flex items-center gap-3">
        <IconLoader2 className="h-5 w-5 text-primary animate-spin" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Processing Bridge Transfers</p>
          <p className="text-xs text-muted-foreground">
            {pendingTxs.length} transfer{pendingTxs.length > 1 ? "s" : ""} waiting for confirmation...
          </p>
        </div>
      </div>
    </div>
  );
}
