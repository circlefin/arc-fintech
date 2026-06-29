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

/**
 * Dedicated endpoint for the Gateway *permissionless* webhook subscription.
 *
 * Circle requires every subscription to have a unique endpoint URL, and the
 * standard DCW notification subscription (transactions.inbound/outbound) already
 * owns `/api/circle/webhook`. Gateway `gateway.deposit.finalized` events are
 * delivered by a separate permissionless subscription, so they need their own
 * URL. The handling logic is identical, so we reuse the same handlers rather
 * than duplicating signature verification and event dispatch.
 */

export { POST, HEAD } from "../webhook/route";
