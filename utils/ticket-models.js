const mongoose = require("mongoose");

const TICKET_SYSTEM_VERSION = "private-channels-v1";
const ACTIVE_TICKET_STATUSES = ["open", "claimed", "paused"];
const TICKET_STATUSES = [...ACTIVE_TICKET_STATUSES, "closed", "legacy_closed"];

function createTicketId() {
  return new mongoose.Types.ObjectId().toHexString();
}

const AttachmentSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: "",
    },
    name: {
      type: String,
      default: "",
    },
    url: {
      type: String,
      default: "",
    },
    contentType: {
      type: String,
      default: "",
    },
    size: {
      type: Number,
      default: 0,
    },
  },
  {
    _id: false,
    versionKey: false,
  },
);

const TicketSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      required: true,
      unique: true,
      default: createTicketId,
    },
    ticketNumber: {
      type: Number,
      required: true,
    },
    guildId: {
      type: String,
      required: true,
    },
    originGuildId: {
      type: String,
      default: "",
    },
    ownerId: {
      type: String,
      default: "",
    },
    categoryId: {
      type: String,
      default: "",
    },
    channelId: {
      type: String,
      default: "",
    },
    controlMessageId: {
      type: String,
      default: "",
    },
    finalMessageId: {
      type: String,
      default: "",
    },
    participantIds: { type: [String], default: [] },
    transcriptPath: { type: String, default: "" },
    channelDeletedAt: { type: Date, default: null },
    finalizedAt: { type: Date, default: null },
    categoryType: {
      type: String,
      required: true,
    },
    minecraftNick: {
      type: String,
      default: "",
    },
    assignedStaffId: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: TICKET_STATUSES,
      default: "open",
    },
    formData: {
      type: Map,
      of: String,
      default: {},
    },
    systemVersion: {
      type: String,
      default: TICKET_SYSTEM_VERSION,
    },
    lastCallAt: {
      type: Date,
      default: null,
    },
    pausedAt: {
      type: Date,
      default: null,
    },
    pausedBy: {
      type: String,
      default: "",
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    closedAt: {
      type: Date,
      default: null,
    },
    closedBy: {
      type: String,
      default: "",
    },
    closeReason: {
      type: String,
      default: "",
    },
  },
  {
    strict: false,
    versionKey: false,
  },
);

TicketSchema.index({ guildId: 1, channelId: 1 }, {
  unique: true,
  partialFilterExpression: {
    channelId: {
      $gt: "",
    },
  },
});
TicketSchema.index({ guildId: 1, ownerId: 1, status: 1 });
TicketSchema.index({ guildId: 1, categoryId: 1, status: 1 });
TicketSchema.index({ guildId: 1, ticketNumber: 1 }, { unique: true });
TicketSchema.index({ guildId: 1, status: 1, categoryType: 1 });
TicketSchema.index(
  { guildId: 1, ownerId: 1 },
  {
    name: "private_ticket_owner_active",
    unique: true,
    partialFilterExpression: {
      ownerId: {
        $gt: "",
      },
      systemVersion: TICKET_SYSTEM_VERSION,
      status: {
        $in: ACTIVE_TICKET_STATUSES,
      },
    },
  },
);

const TicketMessageSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      required: true,
    },
    guildId: {
      type: String,
      required: true,
    },
    direction: {
      type: String,
      enum: ["channel", "system"],
      required: true,
    },
    authorId: {
      type: String,
      default: "",
    },
    avatarUrl: { type: String, default: "" },
    authorTag: {
      type: String,
      default: "",
    },
    content: {
      type: String,
      default: "",
    },
    attachments: {
      type: [AttachmentSchema],
      default: [],
    },
    sourceMessageId: {
      type: String,
      default: "",
    },
    sourceChannelId: {
      type: String,
      default: "",
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
  },
);

TicketMessageSchema.index({ ticketId: 1, createdAt: 1 });
TicketMessageSchema.index({ guildId: 1, direction: 1, createdAt: -1 });
TicketMessageSchema.index({ sourceMessageId: 1 }, {
  unique: true,
  partialFilterExpression: {
    sourceMessageId: {
      $gt: "",
    },
  },
});

const TicketLogSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      default: "",
    },
    guildId: {
      type: String,
      required: true,
    },
    action: {
      type: String,
      required: true,
    },
    executorId: {
      type: String,
      default: "",
    },
    targetId: {
      type: String,
      default: "",
    },
    metadata: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
  },
);

TicketLogSchema.index({ guildId: 1, action: 1, createdAt: -1 });
TicketLogSchema.index({ ticketId: 1, action: 1, createdAt: -1 });
TicketLogSchema.index({ executorId: 1, createdAt: -1 });

const TicketReviewSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      required: true,
    },
    guildId: {
      type: String,
      required: true,
    },
    userId: {
      type: String,
      required: true,
    },
    staffId: {
      type: String,
      default: "",
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },
    comment: {
      type: String,
      default: "",
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
  },
);

TicketReviewSchema.index({ ticketId: 1, userId: 1 }, { unique: true });
TicketReviewSchema.index({ guildId: 1, staffId: 1, createdAt: -1 });

const TicketBlacklistSchema = new mongoose.Schema(
  {
    guildId: {
      type: String,
      required: true,
    },
    userId: {
      type: String,
      required: true,
    },
    reason: {
      type: String,
      default: "",
    },
    staffId: {
      type: String,
      default: "",
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    permanent: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
  },
);

TicketBlacklistSchema.index({ guildId: 1, userId: 1 }, { unique: true });
TicketBlacklistSchema.index({ guildId: 1, permanent: 1, expiresAt: 1 });

const TicketCounterSchema = new mongoose.Schema(
  {
    guildId: {
      type: String,
      required: true,
      unique: true,
    },
    seq: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  {
    versionKey: false,
  },
);

const TicketCategorySchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  discordCategoryId: { type: String, required: true, unique: true },
  categoryType: { type: String, required: true },
  instance: { type: Number, required: true, min: 1 },
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });
TicketCategorySchema.index({ guildId: 1, categoryType: 1, instance: 1 }, { unique: true });
const TicketCategory = mongoose.models.TicketCategory || mongoose.model("TicketCategory", TicketCategorySchema);

const Ticket = mongoose.models.Ticket || mongoose.model("Ticket", TicketSchema);
const TicketMessage = mongoose.models.TicketMessage || mongoose.model("TicketMessage", TicketMessageSchema);
const TicketLog = mongoose.models.TicketLog || mongoose.model("TicketLog", TicketLogSchema);
const TicketReview = mongoose.models.TicketReview || mongoose.model("TicketReview", TicketReviewSchema);
const TicketBlacklist =
  mongoose.models.TicketBlacklist || mongoose.model("TicketBlacklist", TicketBlacklistSchema);
const TicketCounter = mongoose.models.TicketCounter || mongoose.model("TicketCounter", TicketCounterSchema);



async function ensureTicketIndexes() {
  await Promise.all([
    Ticket.init(),
    TicketCategory.init(),
    TicketMessage.init(),
    TicketLog.init(),
    TicketReview.init(),
    TicketBlacklist.init(),
    TicketCounter.init(),
  ]);
}

module.exports = {
  ACTIVE_TICKET_STATUSES,
  TICKET_SYSTEM_VERSION,
  TICKET_STATUSES,
  Ticket,
  TicketBlacklist,
  TicketCounter,
  TicketCategory,
  TicketLog,
  TicketMessage,
  TicketReview,
  ensureTicketIndexes,
};
