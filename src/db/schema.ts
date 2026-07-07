import {
  pgTable, pgEnum, text, uuid, integer, bigint, boolean,
  timestamp, real, jsonb, uniqueIndex, primaryKey,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export const galleryStatusEnum = pgEnum("gallery_status", ["draft", "published", "archived"]);
export const watermarkModeEnum = pgEnum("watermark_mode", ["none", "view", "download", "both"]);
export const photoStatusEnum = pgEnum("photo_status", ["processing", "ready", "error"]);
export const photoOrderEnum = pgEnum("photo_order", ["capture", "filename", "manual"]);
export const galleryThemeEnum = pgEnum("gallery_theme", ["light", "dark"]);
export const activityTypeEnum = pgEnum("activity_type", [
  "access", "like_added", "like_removed", "comment", "download_photo", "download_zip",
]);

export const studios = pgTable("studios", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoKey: text("logo_key"),
  auth0UserId: text("auth0_user_id").notNull().unique(),
  notificationEmail: text("notification_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const galleries = pgTable("galleries", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  status: galleryStatusEnum("status").notNull().default("draft"),
  passwordHash: text("password_hash"),
  coverPhotoId: uuid("cover_photo_id").references((): AnyPgColumn => photos.id, { onDelete: "set null" }),
  coverTemplate: text("cover_template").notNull().default("classic"),
  coverFocalX: real("cover_focal_x").notNull().default(0.5),
  coverFocalY: real("cover_focal_y").notNull().default(0.5),
  theme: galleryThemeEnum("theme").notNull().default("light"),
  photoOrder: photoOrderEnum("photo_order").notNull().default("capture"),
  downloadEnabled: boolean("download_enabled").notNull().default(false),
  resWebEnabled: boolean("res_web_enabled").notNull().default(true),
  resHighEnabled: boolean("res_high_enabled").notNull().default(false),
  resOriginalEnabled: boolean("res_original_enabled").notNull().default(false),
  watermarkMode: watermarkModeEnum("watermark_mode").notNull().default("none"),
  watermarkText: text("watermark_text"),
  watermarkImageKey: text("watermark_image_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sections = pgTable("sections", {
  id: uuid("id").defaultRandom().primaryKey(),
  galleryId: uuid("gallery_id").notNull().references(() => galleries.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  visible: boolean("visible").notNull().default(true),
  // Overrides de entrega: null = hereda de la galería
  watermarkMode: watermarkModeEnum("watermark_mode"),
  downloadEnabled: boolean("download_enabled"),
});

export const photos = pgTable("photos", {
  id: uuid("id").defaultRandom().primaryKey(),
  galleryId: uuid("gallery_id").notNull().references(() => galleries.id, { onDelete: "cascade" }),
  sectionId: uuid("section_id").references(() => sections.id, { onDelete: "set null" }),
  filename: text("filename").notNull(),
  originalKey: text("original_key").notNull(),
  thumbKey: text("thumb_key"),
  webKey: text("web_key"),
  webWmKey: text("web_wm_key"),
  highKey: text("high_key"),
  highWmKey: text("high_wm_key"),
  width: integer("width"),
  height: integer("height"),
  takenAt: timestamp("taken_at", { withTimezone: true }),
  position: integer("position").notNull().default(0),
  published: boolean("published").notNull().default(true),
  status: photoStatusEnum("status").notNull().default("processing"),
  // null = hereda de sección/galería; true/false fuerza marca de agua por foto
  watermarkOverride: boolean("watermark_override"),
  sizeOriginalBytes: bigint("size_original_bytes", { mode: "number" }).notNull().default(0),
  sizeDerivativesBytes: bigint("size_derivatives_bytes", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const clients = pgTable("clients", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("clients_studio_email_idx").on(t.studioId, t.email)]);

export const galleryClients = pgTable("gallery_clients", {
  galleryId: uuid("gallery_id").notNull().references(() => galleries.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.galleryId, t.clientId] })]);

export const likes = pgTable("likes", {
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  photoId: uuid("photo_id").notNull().references(() => photos.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.clientId, t.photoId] })]);

export const comments = pgTable("comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  photoId: uuid("photo_id").notNull().references(() => photos.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const activityEvents = pgTable("activity_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  galleryId: uuid("gallery_id").notNull().references(() => galleries.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  photoId: uuid("photo_id").references(() => photos.id, { onDelete: "set null" }),
  type: activityTypeEnum("type").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Studio = typeof studios.$inferSelect;
export type Gallery = typeof galleries.$inferSelect;
export type Section = typeof sections.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type GalleryStatus = (typeof galleryStatusEnum.enumValues)[number];
