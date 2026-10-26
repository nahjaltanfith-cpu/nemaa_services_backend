import { getPublicStats } from '../services/stats.service.js';
import { handle } from '../utils/handle.js';

export const publicStats = handle('stats public', 200, 'تم جلب الإحصائيات', () => getPublicStats());
