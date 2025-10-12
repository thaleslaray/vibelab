import { ImageType, uploadImageToR2 } from "worker/utils/images";

/**
 * Supported image MIME types for upload
 * Limited to most common web formats for reliability
 */
export const SUPPORTED_IMAGE_MIME_TYPES = [
	'image/png',
	'image/jpeg',
	'image/webp',
] as const;

export type SupportedImageMimeType = typeof SUPPORTED_IMAGE_MIME_TYPES[number];

/**
 * Image attachment for user messages
 * Represents an image that can be sent with text prompts
 */
export interface ImageAttachment {
	/** Unique identifier for this attachment */
	id: string;
	/** Original filename */
	filename: string;
	/** MIME type of the image */
	mimeType: SupportedImageMimeType;
	/** Base64-encoded image data (without data URL prefix) */
	base64Data: string;
	/** Size of the original file in bytes */
	size?: number;
	/** Optional dimensions if available */
	dimensions?: {
		width: number;
		height: number;
	};
}

export interface ProcessedImageAttachment {
	/** MIME type of the image */
	mimeType: SupportedImageMimeType;
	/** Base64-encoded image data (without data URL prefix) */
	base64Data?: string;
    /** R2 key of the image */
    r2Key: string;
    /** image data hash */
    hash: string;
}

function sanitizeBase64Data(dataUrl: string): string {
    return dataUrl.replace(/^data:image\/\w+;base64,/, '');
}

export async function hashImageB64url(dataUrl: string): Promise<string> {
    // This is required for both hashing and uploading.
    const imageBuffer = Buffer.from(sanitizeBase64Data(dataUrl), 'base64');

    // Calculate the SHA-256 hash of the image data for a unique fingerprint.
    const hashBuffer = await crypto.subtle.digest('SHA-256', imageBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hash;
}

export async function processImage(env: Env, image: ImageAttachment): Promise<ProcessedImageAttachment> {    // 1. Decode the base64 data into a buffer (ArrayBuffer).
    const hash = await hashImageB64url(image.base64Data);

    // Upload in R2
    const {r2Key} = await uploadImageToR2(env, image, ImageType.UPLOADS);

    return {
        ...image,
        r2Key: r2Key,
        hash
    }
}

export async function imageToBase64(env: Env, image: ProcessedImageAttachment): Promise<string> {
    try {
        // If base64 data is not available, try to fetch it from the r2 key
        if (!image.base64Data) {
            const r2Key = image.r2Key;
            if (!r2Key) {
                throw new Error('No R2 key provided for image');
            }
            image = await downloadR2Image(env, r2Key);
        }
        return `data:${image.mimeType};base64,${image.base64Data}`;
    } catch (error) {
        console.error('Failed to convert image to base64:', error, image);
        return '';
    }
}

export async function imagesToBase64(env: Env, images: ProcessedImageAttachment[]): Promise<string[]> {
    return (await Promise.all(images.map(image => imageToBase64(env, image)))).filter((image) => image !== '');
}

export async function downloadR2Image(env: Env, r2Key: string) : Promise<ProcessedImageAttachment> {
    const response = await env.TEMPLATES_BUCKET.get(r2Key);
    if (!response || !response.body) {
        throw new Error('Failed to fetch image from R2');
    }
    const arrayBuffer = await response.arrayBuffer();
    const mimeType = response.httpMetadata!.contentType! as SupportedImageMimeType;
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    // Get the filename and mimeType from response
    return {
        base64Data: sanitizeBase64Data(base64),
        r2Key,
        hash: await hashImageB64url(base64),
        mimeType,
    }
}

/**
 * Utility to check if a MIME type is supported
 */
export function isSupportedImageType(mimeType: string): mimeType is SupportedImageMimeType {
	return SUPPORTED_IMAGE_MIME_TYPES.includes(mimeType as SupportedImageMimeType);
}

/**
 * Utility to get file extension from MIME type
 */
export function getFileExtensionFromMimeType(mimeType: SupportedImageMimeType): string {
	const map: Record<SupportedImageMimeType, string> = {
		'image/png': 'png',
		'image/jpeg': 'jpg',
		'image/webp': 'webp',
	};
	return map[mimeType] || 'jpg';
}

/**
 * Maximum file size for images (10MB)
 */
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Maximum number of images per message
 */
export const MAX_IMAGES_PER_MESSAGE = 2;
