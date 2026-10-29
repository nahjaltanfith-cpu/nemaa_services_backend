import * as regions from '../services/region.service.js';
import { handle } from '../utils/handle.js';

export const list = handle('regions list', 200, 'تم جلب المناطق', () => regions.listRegions());
