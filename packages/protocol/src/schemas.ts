import { z } from "zod";

const UUID_V4_LOWERCASE_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64_REGEX =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

// Supported image MIME types for clipboard sync
export const SUPPORTED_IMAGE_MIMES = ["image/png", "image/jpeg"] as const;
export type SupportedImageMime = (typeof SUPPORTED_IMAGE_MIMES)[number];

export const DeviceIdSchema = z
  .string()
  .regex(UUID_V4_LOWERCASE_REGEX, "deviceId must be lowercase UUID v4");

export const Base64Schema = z.string().regex(BASE64_REGEX, "invalid base64");

export const PublicKeySchema = Base64Schema.length(44);

export const PlatformSchema = z.enum(["windows", "mac", "linux"]);

export const HelloMessageSchema = z.object({
  type: z.literal("hello"),
  deviceId: DeviceIdSchema,
  deviceName: z.string().min(1),
  platform: PlatformSchema,
  publicKey: PublicKeySchema,
});

export const HeartbeatMessageSchema = z.object({
  type: z.literal("heartbeat"),
  deviceId: DeviceIdSchema,
  ts: z.number().int().nonnegative(),
});

export const ListDevicesMessageSchema = z.object({
  type: z.literal("list_devices"),
});

export const SignalPayloadSchema = z.object({
  kind: z.enum(["offer", "answer", "ice"]),
  data: z.unknown(),
});

export const SignalMessageSchema = z.object({
  type: z.literal("signal"),
  to: DeviceIdSchema,
  from: DeviceIdSchema,
  payload: SignalPayloadSchema,
});

export const PairCreateMessageSchema = z.object({
  type: z.literal("pair_create"),
  deviceId: DeviceIdSchema,
});

export const PairJoinMessageSchema = z.object({
  type: z.literal("pair_join"),
  deviceId: DeviceIdSchema,
  code: z.string().regex(/^\d{6}$/, "pair code must be 6 digits"),
});

export const PairCreatedMessageSchema = z.object({
  type: z.literal("pair_created"),
  deviceId: DeviceIdSchema,
  code: z.string().regex(/^\d{6}$/),
  expiresAt: z.number().int().nonnegative(),
});

export const PairPairedMessageSchema = z.object({
  type: z.literal("pair_paired"),
  a: DeviceIdSchema,
  b: DeviceIdSchema,
});

export const DeviceInfoSchema = z.object({
  deviceId: DeviceIdSchema,
  deviceName: z.string().min(1),
  platform: PlatformSchema,
  status: z.enum(["online", "offline"]),
  lastSeen: z.number().int().nonnegative(),
  publicKey: PublicKeySchema,
});

export const DevicesUpdateMessageSchema = z.object({
  type: z.literal("devices_update"),
  devices: z.array(DeviceInfoSchema),
});

export const ErrorMessageSchema = z.object({
  type: z.literal("error"),
  code: z.string().min(1),
  message: z.string().min(1),
});

export const ClipEventMessageSchema = z.object({
  type: z.literal("clip_event"),
  eventId: z.string().uuid(),
  originDeviceId: DeviceIdSchema,
  timestampMs: z.number().int().nonnegative(),
  mime: z.string().min(1),
  nonce: Base64Schema,
  ciphertext: Base64Schema,
});

// Metadata message sent before image chunks
export const ClipStartMessageSchema = z.object({
  type: z.literal("clip_start"),
  eventId: z.string().uuid(),
  originDeviceId: DeviceIdSchema,
  timestampMs: z.number().int().nonnegative(),
  mime: z.enum(SUPPORTED_IMAGE_MIMES),
  totalBytes: z.number().int().positive(),
  totalChunks: z.number().int().positive(),
});

// Individual chunk message for image transfer
export const ClipChunkMessageSchema = z.object({
  type: z.literal("clip_chunk"),
  eventId: z.string().uuid(),
  originDeviceId: DeviceIdSchema,
  chunkIndex: z.number().int().nonnegative(),
  totalChunks: z.number().int().positive(),
  mime: z.enum(SUPPORTED_IMAGE_MIMES),
  data: Base64Schema,
});

export const ClientToServerMessageSchema = z.union([
  HelloMessageSchema,
  HeartbeatMessageSchema,
  ListDevicesMessageSchema,
  SignalMessageSchema,
  PairCreateMessageSchema,
  PairJoinMessageSchema,
]);

export const ServerToClientMessageSchema = z.union([
  DevicesUpdateMessageSchema,
  SignalMessageSchema,
  PairCreatedMessageSchema,
  PairPairedMessageSchema,
  ErrorMessageSchema,
]);

export type DeviceId = z.infer<typeof DeviceIdSchema>;
export type Platform = z.infer<typeof PlatformSchema>;
export type HelloMessage = z.infer<typeof HelloMessageSchema>;
export type HeartbeatMessage = z.infer<typeof HeartbeatMessageSchema>;
export type ListDevicesMessage = z.infer<typeof ListDevicesMessageSchema>;
export type SignalPayload = z.infer<typeof SignalPayloadSchema>;
export type SignalMessage = z.infer<typeof SignalMessageSchema>;
export type PairCreateMessage = z.infer<typeof PairCreateMessageSchema>;
export type PairJoinMessage = z.infer<typeof PairJoinMessageSchema>;
export type PairCreatedMessage = z.infer<typeof PairCreatedMessageSchema>;
export type PairPairedMessage = z.infer<typeof PairPairedMessageSchema>;
export type DeviceInfo = z.infer<typeof DeviceInfoSchema>;
export type DevicesUpdateMessage = z.infer<typeof DevicesUpdateMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type ClipEventMessage = z.infer<typeof ClipEventMessageSchema>;
export type ClipStartMessage = z.infer<typeof ClipStartMessageSchema>;
export type ClipChunkMessage = z.infer<typeof ClipChunkMessageSchema>;
export type ClientToServerMessage = z.infer<typeof ClientToServerMessageSchema>;
export type ServerToClientMessage = z.infer<typeof ServerToClientMessageSchema>;
