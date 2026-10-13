export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      decoy_locations: {
        Row: {
          coords: string
          id: number
          location_name: string
          theme: string
        }
        Insert: {
          coords: string
          id?: number
          location_name: string
          theme: string
        }
        Update: {
          coords?: string
          id?: number
          location_name?: string
          theme?: string
        }
        Relationships: []
      }
      islands: {
        Row: {
          coords: string
          fixed_order: number | null
          id: number
          is_fixed: boolean
          location_name: string
          theme: string
        }
        Insert: {
          coords: string
          fixed_order?: number | null
          id?: number
          is_fixed?: boolean
          location_name: string
          theme: string
        }
        Update: {
          coords?: string
          fixed_order?: number | null
          id?: number
          is_fixed?: boolean
          location_name?: string
          theme?: string
        }
        Relationships: []
      }
      ledger: {
        Row: {
          actor: string
          amount: number
          created_at: string
          id: number
          reason: string
          team_id: string
        }
        Insert: {
          actor: string
          amount: number
          created_at?: string
          id?: number
          reason: string
          team_id: string
        }
        Update: {
          actor?: string
          amount?: number
          created_at?: string
          id?: number
          reason?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      pulse: {
        Row: {
          at: string
          id: number
        }
        Insert: {
          at?: string
          id: number
        }
        Update: {
          at?: string
          id?: number
        }
        Relationships: []
      }
      settings: {
        Row: {
          admin_password: string
          id: number
          keeper_password: string
          keeper_word: string
        }
        Insert: {
          admin_password: string
          id?: number
          keeper_password: string
          keeper_word: string
        }
        Update: {
          admin_password?: string
          id?: number
          keeper_password?: string
          keeper_word?: string
        }
        Relationships: []
      }
      teams: {
        Row: {
          astray_wait: boolean
          created_at: string
          current_step: number
          decoy_id: number | null
          finished_at: string | null
          id: string
          last_seen: string | null
          locked_until: string | null
          login_code: string
          name: string
          route: number[]
          session_token: string | null
          status: string
          wrong_tries: number
        }
        Insert: {
          astray_wait?: boolean
          created_at?: string
          current_step?: number
          decoy_id?: number | null
          finished_at?: string | null
          id?: string
          last_seen?: string | null
          locked_until?: string | null
          login_code: string
          name: string
          route: number[]
          session_token?: string | null
          status?: string
          wrong_tries?: number
        }
        Update: {
          astray_wait?: boolean
          created_at?: string
          current_step?: number
          decoy_id?: number | null
          finished_at?: string | null
          id?: string
          last_seen?: string | null
          locked_until?: string | null
          login_code?: string
          name?: string
          route?: number[]
          session_token?: string | null
          status?: string
          wrong_tries?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_add_crew: {
        Args: { p_name: string; p_pass: string }
        Returns: string
      }
      admin_data: { Args: { p_pass: string }; Returns: Json }
      admin_delete_decoy: {
        Args: { p_id: number; p_pass: string }
        Returns: undefined
      }
      admin_release: {
        Args: { p_pass: string; p_team: string }
        Returns: undefined
      }
      admin_remove_crew: {
        Args: { p_pass: string; p_team: string }
        Returns: undefined
      }
      admin_save_decoy: {
        Args: {
          p_coords: string
          p_id: number
          p_loc: string
          p_pass: string
          p_theme: string
        }
        Returns: undefined
      }
      admin_save_island: {
        Args: {
          p_coords: string
          p_id: number
          p_loc: string
          p_pass: string
          p_theme: string
        }
        Returns: undefined
      }
      admin_set: {
        Args: { p_key: string; p_pass: string; p_value: string }
        Returns: undefined
      }
      crew_login: { Args: { p_code: string }; Returns: string }
      crew_state: { Args: { p_token: string }; Returns: Json }
      crew_submit: {
        Args: { p_token: string; p_word: string }
        Returns: string
      }
      keeper_adjust: {
        Args: {
          p_amount: number
          p_pass: string
          p_reason: string
          p_team: string
        }
        Returns: undefined
      }
      keeper_astray: {
        Args: { p_pass: string; p_team: string }
        Returns: undefined
      }
      keeper_grant: {
        Args: { p_pass: string; p_points: number; p_team: string }
        Returns: undefined
      }
      keeper_queue: { Args: { p_pass: string }; Returns: Json }
      keeper_return: {
        Args: { p_pass: string; p_team: string }
        Returns: undefined
      }
      ledger_board: { Args: { p_pass: string }; Returns: Json }
      make_route: { Args: { n: number }; Returns: number[] }
      new_code: { Args: never; Returns: string }
      staff_login: {
        Args: { p_pass: string; p_role: string }
        Returns: boolean
      }
      staff_ok: { Args: { p_admin: boolean; p_pass: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
