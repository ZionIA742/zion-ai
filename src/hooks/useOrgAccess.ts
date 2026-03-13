"use client"

import { useEffect, useState } from "react"
import { createClient } from "@supabase/supabase-js"

type OrgAccessStatus = {
  subscription_status: string
  grace_until: string | null
  is_blocked: boolean
  reason: string | null
  token_limit_mensal: number
  token_consumido_atual: number
  token_pct: number
  ai_mode: "normal" | "econ" | "blocked"
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export function useOrgAccess(orgId: string | null) {
  const [data, setData] = useState<OrgAccessStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) {
      setLoading(false)
      setData(null)
      return
    }

    const fetchStatus = async () => {
      setLoading(true)

      const { data, error } = await supabase.rpc("get_org_access_status", {
        p_org_id: orgId,
      })

      if (error) {
        console.error("Erro ao buscar status da org:", error)
        setData(null)
      } else {
        setData(data as OrgAccessStatus)
      }

      setLoading(false)
    }

    fetchStatus()
  }, [orgId])

  return { data, loading }
}