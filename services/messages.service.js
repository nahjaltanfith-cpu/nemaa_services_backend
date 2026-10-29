import pool from '../db.js';
import { HttpError } from '../utils/httpError.js';
import { EVENTS, emitToThread } from './realtime.service.js';

export const MAX_MESSAGE_LENGTH = 2000;
const THREAD_LIMIT = 500;

const toMessage = (row) => ({
    id: row.id,
    ngoId: row.ngo_id,
    senderType: row.sender_type,
    senderName: row.sender_name,
    // The NGO's picture on its own messages; team messages have none (null)
    senderAvatar: row.sender_avatar,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
});

const MESSAGE_SELECT = `SELECT m.id, m.ngo_id, m.sender_type, m.body, m.created_at, m.read_at,
        CASE WHEN m.sender_type = 'admin' THEN COALESCE(u.name, 'فريق نماء') ELSE n.ngo_name END AS sender_name,
        CASE WHEN m.sender_type = 'admin' THEN NULL ELSE n.avatar_url END AS sender_avatar
    FROM ngo_messages m
    JOIN ngos n ON n.id = m.ngo_id
    LEFT JOIN users u ON u.id = m.sender_user_id`;

const getThreadState = async (ngoId) => {
    const { rows } = await pool.query('SELECT conversation_open FROM ngos WHERE id = $1', [ngoId]);
    if (!rows.length) throw new HttpError(404, 'الجمعية غير موجودة', 'NOT_FOUND');
    return { open: rows[0].conversation_open };
};

/** The latest messages of one NGO's thread, oldest first. */
export const listThread = async (ngoId) => {
    const { open } = await getThreadState(ngoId);
    const { rows } = await pool.query(
        `SELECT * FROM (${MESSAGE_SELECT} WHERE m.ngo_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT $2) t
         ORDER BY created_at, id`,
        [ngoId, THREAD_LIMIT]
    );
    return { conversationOpen: open, messages: rows.map(toMessage) };
};

/** Stores a text message and pushes it to both sides. Closed conversations reject new messages. */
export const sendMessage = async ({ ngoId, senderType, senderUserId = null, body }) => {
    const { rows } = await pool.query(
        `INSERT INTO ngo_messages (ngo_id, sender_type, sender_user_id, body)
         SELECT id, $2, $3, $4 FROM ngos WHERE id = $1 AND conversation_open
         RETURNING id`,
        [ngoId, senderType, senderUserId, body]
    );
    if (!rows.length) {
        await getThreadState(ngoId); // throws 404 when the NGO does not exist
        throw new HttpError(409, 'المحادثة مغلقة حاليًا', 'CONVERSATION_CLOSED');
    }
    const { rows: [row] } = await pool.query(`${MESSAGE_SELECT} WHERE m.id = $1`, [rows[0].id]);
    const message = toMessage(row);
    emitToThread(ngoId, EVENTS.MESSAGE_NEW, { ngoId, message });
    return message;
};

/** Marks the other side's messages as read by `reader` ('admin' | 'ngo'). */
export const markThreadRead = async (ngoId, reader) => {
    const sender = reader === 'admin' ? 'ngo' : 'admin';
    const { rowCount } = await pool.query(
        `UPDATE ngo_messages SET read_at = NOW()
         WHERE ngo_id = $1 AND sender_type = $2 AND read_at IS NULL`,
        [ngoId, sender]
    );
    if (rowCount) emitToThread(ngoId, EVENTS.MESSAGES_READ, { ngoId, reader });
    return { marked: rowCount };
};

/** Opens or closes the conversation (admin only). */
export const setConversationOpen = async (ngoId, open) => {
    const { rowCount } = await pool.query(
        'UPDATE ngos SET conversation_open = $2, updated_at = NOW() WHERE id = $1', [ngoId, open]
    );
    if (!rowCount) throw new HttpError(404, 'الجمعية غير موجودة', 'NOT_FOUND');
    emitToThread(ngoId, EVENTS.CONVERSATION_STATE, { ngoId, open });
    return { conversationOpen: open };
};
