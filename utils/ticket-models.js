const mongoose = require("mongoose");

const ACTIVE_TICKET_STATUSES = ["open", "claimed"];
const TICKET_STATUSES = [...ACTIVE_TICKET_STATUSES, "closed"];

function createTicketId() {
  return new mongoose.Types.ObjectId().toHexString();
}

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
    channelId: {
      type: String,
    },
    panelMessageId: {
      type: String,
      default: "",
    },
    finalMessageId: {
      type: String,
      default: "",
    },
    ownerId: {
      type: String,
      required: true,
    },
    categoryId: {
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
    lastCallAt: {
      type: Date,
      default: null,
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
    versionKey: false,
  },
);

TicketSchema.index(
  { guildId: 1, channelId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      channelId: {
        $gt: "",
      },
    },
  },
);
TicketSchema.index({ guildId: 1, ownerId: 1, status: 1 });
TicketSchema.index({ guildId: 1, ticketNumber: 1 }, { unique: true });
TicketSchema.index({ guildId: 1, status: 1, categoryType: 1 });
TicketSchema.index({ guildId: 1, categoryId: 1, status: 1 });
TicketSchema.index(
  { guildId: 1, ownerId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: {
        $in: ACTIVE_TICKET_STATUSES,
      },
    },
  },
);

const TicketMemberSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      required: true,
    },
    userId: {
      type: String,
      required: true,
    },
    addedBy: {
      type: String,
      required: true,
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

TicketMemberSchema.index({ ticketId: 1, userId: 1 }, { unique: true });
TicketMemberSchema.index({ userId: 1 });

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

const TicketCategorySchema = new mongoose.Schema(
  {
    guildId: {
      type: String,
      required: true,
    },
    discordCategoryId: {
      type: String,
      required: true,
    },
    categoryType: {
      type: String,
      required: true,
    },
    instance: {
      type: Number,
      required: true,
      default: 1,
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

TicketCategorySchema.index({ guildId: 1, discordCategoryId: 1 }, { unique: true });
TicketCategorySchema.index({ guildId: 1, categoryType: 1, instance: 1 }, { unique: true });
TicketCategorySchema.index({ guildId: 1, categoryType: 1 });

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
const TicketMember = mongoose.models.TicketMember || mongoose.model("TicketMember", TicketMemberSchema);
const TicketLog = mongoose.models.TicketLog || mongoose.model("TicketLog", TicketLogSchema);
const TicketReview = mongoose.models.TicketReview || mongoose.model("TicketReview", TicketReviewSchema);
const TicketBlacklist =
  mongoose.models.TicketBlacklist || mongoose.model("TicketBlacklist", TicketBlacklistSchema);
const TicketCategory =
  mongoose.models.TicketCategory || mongoose.model("TicketCategory", TicketCategorySchema);
const TicketCounter = mongoose.models.TicketCounter || mongoose.model("TicketCounter", TicketCounterSchema);

async function ensureTicketIndexes() {
  await Promise.all([
    Ticket.init(),
    TicketMember.init(),
    TicketLog.init(),
    TicketReview.init(),
    TicketBlacklist.init(),
    TicketCategory.init(),
    TicketCounter.init(),
  ]);
}

module.exports = {
  ACTIVE_TICKET_STATUSES,
  TICKET_STATUSES,
  Ticket,
  TicketBlacklist,
  TicketCategory,
  TicketCounter,
  TicketLog,
  TicketMember,
  TicketReview,
  ensureTicketIndexes,
};
