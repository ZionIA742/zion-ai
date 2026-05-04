export type StoreRow = {
  id: string;
  organization_id: string;
  name: string | null;
};

export type StoreAnswerRow = {
  question_key: string;
  answer: unknown;
};

export type AssistantMessageRow = {
  sender: string | null;
  sender_role: string | null;
  direction: string | null;
  message_type: string | null;
  content: string | null;
  created_at: string | null;
};

export type AppointmentRow = {
  id: string;
  title: string | null;
  appointment_type: string | null;
  status: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  address_text: string | null;
  notes: string | null;
  lead_id: string | null;
  conversation_id: string | null;
};

export type StoreScheduleSettingsRow = {
  operating_days: string[] | null;
  operating_hours: Record<string, { start?: string; end?: string }> | null;
  timezone_name: string | null;
};

export type StoreScheduleBlockRow = {
  id: string;
  title: string | null;
  block_type: string | null;
  start_at: string | null;
  end_at: string | null;
  source: string | null;
  notes: string | null;
};

export type PendingNotificationRow = {
  id: string;
  notification_type: string | null;
  priority: string | null;
  title: string | null;
  body: string | null;
  created_at: string | null;
  related_lead_id: string | null;
  related_conversation_id: string | null;
  related_appointment_id: string | null;
};

export type PostAppointmentFollowupRow = {
  id: string;
  organization_id: string;
  store_id: string;
  appointment_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  scheduled_end: string | null;
  followup_status: string | null;
  preferred_channel: string | null;
  prompt_count: number | null;
  last_prompted_at: string | null;
  confirmed_at: string | null;
  resolved_at: string | null;
  resolution: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type StoreAssistantContextStateRow = {
  id: string;
  organization_id: string;
  store_id: string;
  thread_id: string;
  active_topic: string | null;
  active_intent: string | null;
  active_status: string;
  active_customer_name: string | null;
  active_customer_phone: string | null;
  active_lead_id: string | null;
  active_conversation_id: string | null;
  active_appointment_id: string | null;
  target_date: string | null;
  target_time: string | null;
  target_start_at: string | null;
  target_end_at: string | null;
  timezone_name: string;
  candidate_options: unknown;
  context_payload: unknown;
  last_user_message: string | null;
  last_assistant_message: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type StoreAssistantOperationalTaskRow = {
  id: string;
  organization_id: string;
  store_id: string;
  thread_id: string | null;
  task_type: string;
  status: string;
  priority: string;
  title: string;
  description: string | null;
  related_lead_id: string | null;
  related_conversation_id: string | null;
  related_appointment_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  target_date: string | null;
  target_time: string | null;
  target_start_at: string | null;
  target_end_at: string | null;
  timezone_name: string | null;
  task_payload: unknown;
  last_action_at: string | null;
  resolved_at: string | null;
  cancelled_at: string | null;
  error_text: string | null;
  created_at: string;
  updated_at: string;
};

export type AssistantCandidateOption = {
  option_number: number;
  source_index: number;
  appointment_id: string;
  title: string | null;
  appointment_type: string | null;
  status: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  lead_id: string | null;
  conversation_id: string | null;
};

export type AssistantReplyResult =
  | {
      ok: true;
      aiText: string;
    }
  | {
      ok: false;
      error: string;
      message: string;
    };

export type CustomerRescheduleWorkflowResult =
  | { type: "not_applicable" }
  | { type: "needs_target"; reply: string }
  | { type: "needs_date"; reply: string }
  | { type: "needs_time"; reply: string }
  | { type: "missing_conversation"; reply: string }
  | { type: "send_failed"; reply: string; error?: string }
  | { type: "message_sent"; reply: string; messageId: string | null; taskId: string | null };
