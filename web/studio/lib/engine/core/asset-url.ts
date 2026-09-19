// assetUrl. Cache-buster dropped; assets live in public/theme/.
import { store } from "./store";

export function assetUrl(path: string): string {
  return `${store.assetsUrl}${path}`;
}

export default assetUrl;
