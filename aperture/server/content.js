/* Server mode: load the compiled course bundle into the shared content module. */
import CONTENT from '../build/content.json';
import { setContent } from '../../apps/aperture/shared/content-core.js';
setContent(CONTENT);
