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

import { ComplianceCheckResponse } from "@/types/compliance";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ComplianceStatusBadge } from "@/components/compliance-status-badge";
import { Badge } from "@/components/ui/badge";
import { getRiskCategoryLabel } from "@/lib/compliance/utils";
import { Separator } from "@/components/ui/separator";

interface ComplianceDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  complianceData: ComplianceCheckResponse | null;
  address: string;
}

export function ComplianceDetailsDialog({
  open,
  onOpenChange,
  complianceData,
  address,
}: ComplianceDetailsDialogProps) {
  if (!complianceData) return null;

  const { result, message, details } = complianceData;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Compliance Screening Details</DialogTitle>
          <DialogDescription>
            Screening results for address:{" "}
            <span className="font-mono text-xs">
              {address.slice(0, 10)}...{address.slice(-8)}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Status</span>
            <ComplianceStatusBadge result={result} />
          </div>

          <Separator />

          {/* Message */}
          <div className="space-y-2">
            <span className="text-sm font-medium">Result</span>
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>

          {/* Details if available */}
          {details && (
            <>
              <Separator />

              {/* Rule Name */}
              {details.ruleName && (
                <div className="space-y-2">
                  <span className="text-sm font-medium">Matched Rule</span>
                  <p className="text-sm text-muted-foreground">{details.ruleName}</p>
                </div>
              )}

              {/* Risk Categories */}
              {details.riskCategories && details.riskCategories.length > 0 && (
                <div className="space-y-2">
                  <span className="text-sm font-medium">Risk Categories</span>
                  <div className="flex flex-wrap gap-2">
                    {details.riskCategories.map((category) => (
                      <Badge key={category} variant="outline">
                        {getRiskCategoryLabel(category)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Risk Score */}
              {details.riskScore && (
                <div className="space-y-2">
                  <span className="text-sm font-medium">Risk Score</span>
                  <Badge variant="outline">{details.riskScore}</Badge>
                </div>
              )}

              {/* Recommended Actions */}
              {details.actions && details.actions.length > 0 && (
                <div className="space-y-2">
                  <span className="text-sm font-medium">Recommended Actions</span>
                  <div className="flex flex-wrap gap-2">
                    {details.actions.map((action) => (
                      <Badge key={action} variant="secondary">
                        {action}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Screening Date */}
              {details.screeningDate && (
                <div className="space-y-2">
                  <span className="text-sm font-medium">Screening Date</span>
                  <p className="text-sm text-muted-foreground">
                    {new Date(details.screeningDate).toLocaleString()}
                  </p>
                </div>
              )}

              {/* Detailed Reasons */}
              {details.reasons && details.reasons.length > 0 && (
                <div className="space-y-2">
                  <span className="text-sm font-medium">Details</span>
                  <div className="space-y-2 rounded-lg border bg-muted/50 p-3">
                    {details.reasons.map((reason, index) => (
                      <div key={index} className="space-y-1 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">Source:</span>
                          <span className="text-muted-foreground">{reason.source}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">Type:</span>
                          <span className="text-muted-foreground">{reason.type}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
