import * as core from '@actions/core';
import * as cache from '@actions/cache';
import { HttpClient } from '@actions/http-client';
import * as path from 'node:path';
import fetch, { Headers } from 'node-fetch';
import contentDisposition from 'content-disposition';
import * as fs from 'fs';
import { createHash } from 'crypto';

type CacheEntry = {
    /* The version of the cache entry. */
    version: number;
    /* The timestamp of when the cache entry was saved, in milliseconds. */
    saveTime: number;
    /**
     * Cache tag to use to determine if the file needs to be re-downloaded. If absent, will cache for as long as the
     * user wants.
     */
    uniquenessTag: string | null;
};

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
    try {
        const now = Date.now();
        const url = core.getInput('url');
        const headersStr = core.getInput('headers').trim();

        const maxAgeInput = core.getInput('max-age');
        const maxAge = maxAgeInput === '' ? null : Number(maxAgeInput);
        if (
            typeof maxAge === 'number' &&
            (!Number.isFinite(maxAge) || maxAge < 0)
        ) {
            throw new Error(`Invalid max-age: ${maxAge}`);
        }

        const headers = new Headers({ 'User-Agent': 'download-file-action' });
        if (headersStr !== '') {
            for (const header of headersStr.split(/\r?\n/)) {
                const match = /([^:]+):\s*(.+)/.exec(header);
                if (!match) {
                    throw new Error(`Invalid header: ${header}`);
                }
                headers.set(match[1], match[2]);
            }
        }

        core.debug(`Fetching ${url} ...`);

        const controller = new AbortController();
        const response = await fetch(url, {
            headers,
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(
                `Failed to fetch ${url}: ${response.status} ${response.statusText}`
            );
        }
        if (!response.body) {
            throw new Error(`Failed to fetch ${url}: no body`);
        }

        // Determine the filename to save the response to
        const contentDispositionHeader = response.headers.get(
            'content-disposition'
        );
        let filename = core.getInput('destination');
        if (!filename) {
            if (contentDispositionHeader) {
                filename = contentDisposition.parse(contentDispositionHeader)
                    .parameters.filename;
            }
            if (!filename) {
                const baseName = url.split('/').pop();
                if (!baseName) {
                    throw new Error(`Failed to determine filename for ${url}`);
                }
                filename = decodeURIComponent(baseName);
            }
        }

        // Check the cache
        let uniquenessTag = response.headers.get('etag');
        if (!uniquenessTag) {
            uniquenessTag = response.headers.get('last-modified');
        }

        const cacheHash = createHash('sha256').update(url).update(headersStr);

        await fs.promises.mkdir('.download-file-action', { recursive: true });
        const metaFilename = path.join('.download-file-action', filename);

        const additionalCacheKey = core.getInput('additional-cache-key');
        if (additionalCacheKey !== '') {
            cacheHash.update(additionalCacheKey);
        }
        const cacheDigest = cacheHash.digest('hex');

        const cacheKey = `download-${cacheDigest}`;
        const cacheRestored = await cache.restoreCache(
            [filename, metaFilename],
            cacheKey,
            [cacheDigest]
        );

        // Check cache
        if (cacheRestored) {
            const metaFile = await fs.promises.readFile(metaFilename, 'utf8');
            const cacheEntry = JSON.parse(metaFile) as CacheEntry;
            if (cacheEntry.version === 1) {
                const age = (now - cacheEntry.saveTime) / 1000;
                const tagMatches = cacheEntry.uniquenessTag === uniquenessTag;
                if (tagMatches && maxAge !== 0 && (!maxAge || age < maxAge)) {
                    core.info(`Using cached file ${filename}`);
                    controller.abort();
                    core.setOutput('destination', filename);
                    return;
                }
            }
        }

        // Cache miss: save the response to a file
        core.info(`Saving ${url} to ${filename} ...`);
        const destFile = fs.createWriteStream(filename);
        response.body.pipe(destFile);

        await new Promise<void>((resolve, reject) => {
            destFile.once('finish', () => {
                destFile.close();
                core.debug(`Downloaded ${url} to ${filename}`);
                resolve();
            });
            destFile.once('error', err => {
                destFile.close();
                reject(err);
            });
        });

        core.setOutput('destination', filename);
    } catch (error) {
        // Fail the workflow run if an error occurs
        if (error instanceof Error) core.setFailed(error.message);
    }
}
