const mongoose = require("mongoose");

const MODMAIL_SYSTEM_VERSION = "modmail-v2";
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
    userId: {
      type: String,
      default: "",
    },
    staffCategoryId: {
      type: String,
      default: "",
    },
    staffChannelId: {
      type: String,
      default: "",
    },
    staffControlMessageId: {
      type: String,
      default: "",
    },
    finalMessageId: {
      type: String,
      default: "",
    },
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
      default: MODMAIL_SYSTEM_VERSION,
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

TicketSchema.index({ guildId: 1, staffChannelId: 1 }, {
  unique: true,
  partialFilterExpression: {
    staffChannelId: {
      $gt: "",
    },
  },
});
TicketSchema.index({ guildId: 1, userId: 1, status: 1 });
TicketSchema.index({ guildId: 1, ticketNumber: 1 }, { unique: true });
TicketSchema.index({ guildId: 1, status: 1, categoryType: 1 });
TicketSchema.index(
  { guildId: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      userId: {
        $gt: "",
      },
      systemVersion: MODMAIL_SYSTEM_VERSION,
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
      enum: ["user_to_staff", "staff_to_user", "system"],
      required: true,
    },
    authorId: {
      type: String,
      default: "",
    },
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
    targetMessageId: {
      type: String,
      default: "",
    },
    targetChannelId: {
      type: String,
      default: "",
    },
    delivered: {
      type: Boolean,
      default: true,
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

const Ticket = mongoose.models.Ticket || mongoose.model("Ticket", TicketSchema);
const TicketMessage = mongoose.models.TicketMessage || mongoose.model("TicketMessage", TicketMessageSchema);
const TicketLog = mongoose.models.TicketLog || mongoose.model("TicketLog", TicketLogSchema);
const TicketReview = mongoose.models.TicketReview || mongoose.model("TicketReview", TicketReviewSchema);
const TicketBlacklist =
  mongoose.models.TicketBlacklist || mongoose.model("TicketBlacklist", TicketBlacklistSchema);
const TicketCounter = mongoose.models.TicketCounter || mongoose.model("TicketCounter", TicketCounterSchema);

async function dropLegacyTicketIndexes() {
  const legacyIndexNames = [
    "guildId_1_channelId_1",
    "guildId_1_ownerId_1_status_1",
    "guildId_1_categoryId_1_status_1",
    "guildId_1_ownerId_1",
  ];

  for (const indexName of legacyIndexNames) {
    await Ticket.collection.dropIndex(indexName).catch((error) => {
      const ignoredCodeNames = ["IndexNotFound", "NamespaceNotFound"];
      const ignoredCodes = [26, 27];

      if (!ignoredCodeNames.includes(error?.codeName) && !ignoredCodes.includes(error?.code)) {
        throw error;
      }
    });
  }
}

async function ensureTicketIndexes() {
  await dropLegacyTicketIndexes();
  await Promise.all([
    Ticket.init(),
    TicketMessage.init(),
    TicketLog.init(),
    TicketReview.init(),
    TicketBlacklist.init(),
    TicketCounter.init(),
  ]);
}

module.exports = {
  ACTIVE_TICKET_STATUSES,
  MODMAIL_SYSTEM_VERSION,
  TICKET_STATUSES,
  Ticket,
  TicketBlacklist,
  TicketCounter,
  TicketLog,
  TicketMessage,
  TicketReview,
  ensureTicketIndexes,
};
