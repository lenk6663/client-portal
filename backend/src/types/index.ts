export interface User {
  id: string;
  phone: string;
  password_hash?: string;
  name: string;
  email?: string;
  organization_id?: string;
  role: 'client' | 'operator' | 'admin';
  can_approve: boolean;
  push_token?: string;
  notification_settings?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Organization {
  id: string;
  name: string;
  inn: string;
  link_to_1c_id?: string;
  is_active: boolean;
  created_at: string;
}

export interface Ticket {
  id: string;
  ticket_number_1c?: string;
  client_id: string;
  organization_id: string;
  subject: string;
  description?: string;
  type: string;
  urgency: string;
  status_code: string;
  assigned_department?: string;
  assigned_operator?: string;
  version: number;
  created_at_1c?: string;
  updated_at_1c?: string;
  last_sync_at?: string;
  data_snapshot?: Record<string, unknown>;
  sync_status: string;
  created_at: string;
  updated_at: string;
  // joined fields
  services?: string[];
}

export interface Message {
  id: string;
  ticket_id: string;
  author_id: string;
  text?: string;
  sent_at: string;
  type: string;
  metadata?: Record<string, unknown>;
  sync_status: string;
  // joined
  author_name?: string;
}

export interface FileRecord {
  id: string;
  ticket_id?: string;
  message_id?: string;
  author_id: string;
  original_name: string;
  mime_type?: string;
  size?: number;
  storage_path?: string;
  uploaded_at: string;
  checksum?: string;
  sync_status: string;
  upload_confirmed: boolean;
}

export interface HistoryEntry {
  id: string;
  ticket_id: string;
  changed_by_user_id?: string;
  changed_at: string;
  field_name: string;
  old_value?: string;
  new_value?: string;
  source: string;
}

export interface OutboxEvent {
  id: string;
  event_type: string;
  aggregate_id: string;
  aggregate_type: string;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
  retry_count: number;
  last_error?: string;
  scheduled_after: string;
}

export interface JwtPayload {
  sub: string;          // user id
  phone: string;
  role: string;
  iat?: number;
  exp?: number;
}

// Express augmentation — добавляем user к Request
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
