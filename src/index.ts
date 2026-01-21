/**
 * Matterbridge Dreame Vacuum Plugin
 *
 * This plugin provides Matter 1.4 support for Dreame robot vacuum cleaners,
 * enabling control via Apple Home, Google Home, Alexa, and other Matter-compatible platforms.
 *
 * @file index.ts
 * @license Apache-2.0
 */

import { Matterbridge, PlatformConfig } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';

import { DreamePlatform } from './platform.js';

/**
 * Initialize the Dreame vacuum plugin.
 *
 * This is the standard Matterbridge plugin entry point.
 *
 * @param matterbridge - The Matterbridge instance
 * @param log - Logger instance for the plugin
 * @param config - Platform configuration from Matterbridge
 * @returns The initialized DreamePlatform instance
 */
export default function initializePlugin(matterbridge: Matterbridge, log: AnsiLogger, config: PlatformConfig): DreamePlatform {
  return new DreamePlatform(matterbridge, log, config);
}
