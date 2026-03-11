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
import { IconRefresh, IconClock } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { 
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface DataFreshnessIndicatorProps {
  lastUpdated: Date | string | null
  isRefreshing?: boolean
  onRefresh?: () => void
  className?: string
}

export function DataFreshnessIndicator({
  lastUpdated,
  isRefreshing = false,
  onRefresh,
  className = ""
}: DataFreshnessIndicatorProps) {
  const [timeAgo, setTimeAgo] = React.useState("")

  React.useEffect(() => {
    if (!lastUpdated) {
      setTimeAgo("Syncing...")
      return
    }

    const updateTimeAgo = () => {
      const now = new Date()
      const updated = new Date(lastUpdated)
      const diffMs = now.getTime() - updated.getTime()
      const diffMins = Math.floor(diffMs / (1000 * 60))

      if (diffMins < 1) {
        setTimeAgo("Just now")
      } else if (diffMins < 60) {
        setTimeAgo(`${diffMins}m ago`)
      } else if (diffMins < 1440) {
        const hours = Math.floor(diffMins / 60)
        setTimeAgo(`${hours}h ago`)
      } else {
        const days = Math.floor(diffMins / 1440)
        setTimeAgo(`${days}d ago`)
      }
    }

    updateTimeAgo()
    const interval = setInterval(updateTimeAgo, 30000) // Update every 30 seconds

    return () => clearInterval(interval)
  }, [lastUpdated])

  const getFreshnessColor = () => {
    if (!lastUpdated) return "bg-gray-500"
    
    const now = new Date()
    const updated = new Date(lastUpdated)
    const diffMins = Math.floor((now.getTime() - updated.getTime()) / (1000 * 60))

    if (diffMins < 5) return "bg-green-500"
    if (diffMins < 30) return "bg-yellow-500"
    return "bg-red-500"
  }

  return (
    <TooltipProvider>
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full ${getFreshnessColor()}`} />
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <IconClock className="size-3" />
            {timeAgo}
          </span>
        </div>
        
        {onRefresh && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="h-6 w-6 p-0"
              >
                <IconRefresh 
                  className={`size-3 ${isRefreshing ? "animate-spin" : ""}`} 
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Refresh data</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  )
}