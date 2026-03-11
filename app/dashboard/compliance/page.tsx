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
import { ComplianceLog } from "@/types/compliance";
import { ComplianceStatusBadge } from "@/components/compliance-status-badge";
import { ComplianceDetailsDialog } from "@/components/compliance-details-dialog";
import { ComplianceCheckResponse } from "@/types/compliance";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IconLoader2, IconFileText, IconCopy, IconDownload, IconFilter, IconX } from "@tabler/icons-react";
import { getRiskCategoryLabel } from "@/lib/compliance/utils";
import { toast } from "sonner";
import { BLOCK_EXPLORERS } from "@/lib/constants/block-explorers";

export default function CompliancePage() {
  const [logs, setLogs] = useState<ComplianceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [resultFilter, setResultFilter] = useState<string>("all");
  const [blockchainFilter, setBlockchainFilter] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [selectedLog, setSelectedLog] = useState<ComplianceLog | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    fetchLogs();
  }, [resultFilter, blockchainFilter, startDate, endDate]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      
      if (resultFilter !== "all") {
        params.append("result", resultFilter);
      }
      
      if (blockchainFilter !== "all") {
        params.append("blockchain", blockchainFilter);
      }
      
      if (startDate) {
        params.append("startDate", startDate);
      }
      
      if (endDate) {
        params.append("endDate", endDate);
      }

      const url = `/api/compliance/logs${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(url);
      const data = await response.json();
      setLogs(data.logs || []);
    } catch (error) {
      console.error("Failed to fetch compliance logs:", error);
      toast.error("Failed to load compliance logs");
    } finally {
      setLoading(false);
    }
  };

  const handleViewDetails = (log: ComplianceLog) => {
    setSelectedLog(log);
    setShowDetails(true);
  };

  const formatComplianceDataForDialog = (
    log: ComplianceLog
  ): ComplianceCheckResponse => {
    return {
      success: true,
      result: log.result,
      message: getMessageForResult(log.result),
      details: {
        ruleName: log.rule_name || undefined,
        actions: log.actions || undefined,
        riskCategories: log.risk_categories || undefined,
        riskScore: log.risk_score || undefined,
        reasons: log.reasons || undefined,
        screeningDate: log.screening_date,
      },
    };
  };

  const getMessageForResult = (result: string): string => {
    switch (result) {
      case "PASS":
        return "This address has passed compliance screening.";
      case "REVIEW":
        return "This address requires manual review before proceeding.";
      case "FAIL":
        return "This address has been flagged and transactions are blocked.";
      default:
        return "Unknown compliance status.";
    }
  };

  const shortenAddress = (address: string) => {
    if (!address) return "";
    if (address.length <= 10) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Address copied to clipboard");
  };

  const getExplorerUrl = (blockchain: string, address: string) => {
    const baseUrl = BLOCK_EXPLORERS[blockchain];
    if (!baseUrl) return "#";
    return `${baseUrl}/address/${address}`;
  };

  const exportToCSV = () => {
    if (logs.length === 0) {
      toast.error("No data to export");
      return;
    }

    // Create CSV headers
    const headers = [
      "Date",
      "Address",
      "Blockchain",
      "Result",
      "Rule",
      "Risk Score",
      "Risk Categories",
      "Actions"
    ];

    // Create CSV rows
    const rows = logs.map((log) => [
      new Date(log.created_at).toLocaleString("en-US"),
      log.wallet_address,
      log.blockchain,
      log.result,
      log.rule_name || "-",
      log.risk_score || "-",
      log.risk_categories?.map(getRiskCategoryLabel).join("; ") || "-",
      log.actions?.join("; ") || "-"
    ]);

    // Combine headers and rows
    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      )
    ].join("\n");

    // Create and download file
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `compliance-logs-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.success("CSV exported successfully");
  };

  const clearFilters = () => {
    setResultFilter("all");
    setBlockchainFilter("all");
    setStartDate("");
    setEndDate("");
  };

  const hasActiveFilters = resultFilter !== "all" || blockchainFilter !== "all" || startDate || endDate;

  // Get unique blockchains from logs for filter options
  const availableBlockchains = Array.from(new Set(logs.map(log => log.blockchain)));

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      {/* Header and Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <IconFilter className="size-4" />
            Filters
            {hasActiveFilters && (
              <Badge variant="secondary" className="ml-2">
                {[resultFilter !== "all", blockchainFilter !== "all", startDate, endDate].filter(Boolean).length}
              </Badge>
            )}
          </Button>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
            >
              <IconX className="size-4" />
              Clear
            </Button>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={exportToCSV}
          disabled={logs.length === 0}
        >
          <IconDownload className="size-4" />
          Export CSV
        </Button>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="grid gap-4 p-4 border rounded-lg bg-muted/50">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="result-filter">Result</Label>
              <Select value={resultFilter} onValueChange={setResultFilter}>
                <SelectTrigger id="result-filter">
                  <SelectValue placeholder="All Results" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Results</SelectItem>
                  <SelectItem value="PASS">Pass</SelectItem>
                  <SelectItem value="REVIEW">Review</SelectItem>
                  <SelectItem value="FAIL">Fail</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="blockchain-filter">Chain</Label>
              <Select value={blockchainFilter} onValueChange={setBlockchainFilter}>
                <SelectTrigger id="blockchain-filter">
                  <SelectValue placeholder="All Chains" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Chains</SelectItem>
                  <SelectItem value="ETH-SEPOLIA">Ethereum Sepolia</SelectItem>
                  <SelectItem value="BASE-SEPOLIA">Base Sepolia</SelectItem>
                  <SelectItem value="AVAX-FUJI">Avalanche Fuji</SelectItem>
                  <SelectItem value="ARC-TESTNET">Arc Testnet</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="end-date">End Date</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <IconLoader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 border border-dashed rounded-lg">
          <IconFileText className="size-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No compliance logs found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {hasActiveFilters
              ? "No logs match your filter criteria."
              : "Compliance checks will appear here once you screen wallet addresses."}
          </p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Blockchain</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Rule</TableHead>
                <TableHead>Risk Categories</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(log.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "numeric",
                    })}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <a
                        href={getExplorerUrl(log.blockchain, log.wallet_address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-sm text-muted-foreground hover:text-primary hover:underline transition-colors"
                      >
                        {shortenAddress(log.wallet_address)}
                      </a>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => copyToClipboard(log.wallet_address)}
                      >
                        <IconCopy className="h-3 w-3" />
                        <span className="sr-only">Copy address</span>
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{log.blockchain}</Badge>
                  </TableCell>
                  <TableCell>
                    <ComplianceStatusBadge result={log.result} />
                  </TableCell>
                  <TableCell className="text-sm">
                    {log.rule_name || "-"}
                  </TableCell>
                  <TableCell>
                    {log.risk_categories && log.risk_categories.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {log.risk_categories.slice(0, 2).map((category) => (
                          <Badge key={category} variant="secondary" className="text-xs">
                            {getRiskCategoryLabel(category)}
                          </Badge>
                        ))}
                        {log.risk_categories.length > 2 && (
                          <Badge variant="secondary" className="text-xs">
                            +{log.risk_categories.length - 2}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleViewDetails(log)}
                    >
                      View Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Compliance Details Dialog */}
      {selectedLog && (
        <ComplianceDetailsDialog
          open={showDetails}
          onOpenChange={setShowDetails}
          complianceData={formatComplianceDataForDialog(selectedLog)}
          address={selectedLog.wallet_address}
        />
      )}
    </div>
  );
}
