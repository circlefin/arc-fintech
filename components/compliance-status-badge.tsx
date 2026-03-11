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

import { ComplianceResult } from "@/types/compliance";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

interface ComplianceStatusBadgeProps {
  result: ComplianceResult;
  className?: string;
}

export function ComplianceStatusBadge({ result, className }: ComplianceStatusBadgeProps) {
  const config = {
    PASS: {
      label: "Allowed",
      variant: "default" as const,
      icon: CheckCircle2,
      className: "bg-green-500/10 text-green-700 hover:bg-green-500/20 dark:text-green-400",
    },
    REVIEW: {
      label: "Review Required",
      variant: "default" as const,
      icon: AlertTriangle,
      className: "bg-yellow-500/10 text-yellow-700 hover:bg-yellow-500/20 dark:text-yellow-400",
    },
    FAIL: {
      label: "Blocked",
      variant: "default" as const,
      icon: XCircle,
      className: "bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:text-red-400",
    },
  };

  const { label, icon: Icon, className: badgeClassName } = config[result];

  return (
    <Badge variant="default" className={`${badgeClassName} ${className || ""}`}>
      <Icon className="mr-1 size-3" />
      {label}
    </Badge>
  );
}
