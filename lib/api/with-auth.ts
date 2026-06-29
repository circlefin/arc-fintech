/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { NextRequest, NextResponse } from "next/server"
import type { SupabaseClient, User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"

export type AuthContext = {
  user: User
  supabase: SupabaseClient
}

export type AuthedHandler = (
  request: NextRequest,
  ctx: AuthContext
) => Promise<NextResponse> | NextResponse

/**
 * Wraps a Next.js Route Handler with the canonical 8-line auth preamble:
 *
 *     const supabase = await createClient()
 *     const { data: { user } } = await supabase.auth.getUser()
 *     if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
 *
 * Adopt this on new routes; existing routes can migrate gradually. The
 * unauthorized 500 catch is intentionally left to each handler so they can
 * tailor error messages and HTTP codes to their own domain.
 */
export function withAuth(handler: AuthedHandler) {
  return async (request: NextRequest) => {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    return handler(request, { user, supabase })
  }
}
