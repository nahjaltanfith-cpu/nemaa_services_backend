import { publicUrl } from './upload.service.js';

// Registration documents: API key ↔ column. Labels match the frontend cards.
export const DOCUMENTS = [
    { key: 'ngoDocument', column: 'ngo_document_key', label: 'وثيقة تعريف الجمعية' },
    { key: 'representativeProof', column: 'representative_proof_key', label: 'إثبات صفة الممثل' },
];

export const ACCOUNT_STATUSES = ['new', 'under_review', 'needs_documents', 'approved'];

// Columns behind toPublicNgo. Usable in SELECT and in UPDATE … RETURNING on `ngos`.
export const NGO_COLUMNS = `id, ngo_name, reg_number, field_of_work, representative_name,
    position, email, mobile, account_status, ngo_document_key, representative_proof_key,
    admin_notes, status_updated_at, status_seen_at, conversation_open, created_at,
    (SELECT COUNT(*) FROM ngo_messages m
      WHERE m.ngo_id = ngos.id AND m.sender_type = 'admin' AND m.read_at IS NULL) AS unread_from_admin,
    (SELECT COUNT(*) FROM ngo_messages m
      WHERE m.ngo_id = ngos.id AND m.sender_type = 'ngo' AND m.read_at IS NULL) AS unread_from_ngo`;

export const hasAllDocuments = (row) => DOCUMENTS.every(({ column }) => row[column]);

/** API shape of an NGO. `viewer` decides which side's unread count is exposed. */
export const toPublicNgo = (row, viewer = 'ngo') => ({
    id: row.id,
    ngoName: row.ngo_name,
    regNumber: row.reg_number,
    fieldOfWork: row.field_of_work,
    representativeName: row.representative_name,
    position: row.position,
    email: row.email,
    mobile: row.mobile,
    accountStatus: row.account_status,
    adminNotes: row.admin_notes,
    statusUpdatedAt: row.status_updated_at,
    // Status changes the NGO has not opened yet (drives the glowing indicator).
    hasUnseenStatus: Boolean(row.status_updated_at
        && (!row.status_seen_at || row.status_seen_at < row.status_updated_at)),
    conversationOpen: row.conversation_open,
    unreadMessages: viewer === 'admin' ? row.unread_from_ngo : row.unread_from_admin,
    createdAt: row.created_at,
    documents: DOCUMENTS.map(({ key, column, label }) => ({
        key,
        label,
        status: row[column] ? 'uploaded' : 'missing',
        fileUrl: row[column] ? publicUrl(row[column]) : null,
    })),
});
