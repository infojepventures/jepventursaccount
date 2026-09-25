import { FONT_REL, LOGO_REL, resolveAsset } from '../lib/assets';
import { handle } from '../lib/http';

export default handle(
  async () => ({
    ok: true,
    node: process.version,
    assets: { font: !!resolveAsset(FONT_REL), logo: !!resolveAsset(LOGO_REL) },
  }),
  { method: 'GET' },
);
