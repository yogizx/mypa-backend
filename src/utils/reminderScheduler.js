'use strict';

const Meeting = require('../models/Meeting');
const User    = require('../models/User');
const { sendMeetingReminderEmail } = require('./mailer');

const TICK_MS = 60 * 1000;
let _timer = null;

// ── In-memory retry buffer ────────────────────────────────────────────────────
// Maps meetingId → { type, attempt, nextRetryAt }
const _retryQueue = new Map();

const MAX_RETRIES = 5;
const RETRY_BASE_MS = 30 * 1000; // 30 s, doubles each attempt

async function _sendIfNeeded(meeting, user, type) {
  const prefs = user.notificationPrefs || {};
  const flagMap = {
    onCreate: { pref: 'reminderOnCreate', flag: 'reminderSentOnCreate' },
    at30:     { pref: 'reminderAt30',     flag: 'reminderSent30'       },
    at15:     { pref: 'reminderAt15',     flag: 'reminderSent15'       },
    atStart:  { pref: 'reminderAtStart',  flag: 'reminderSentStart'    },
  };

  const { pref, flag } = flagMap[type];

  if (prefs.emailReminders === false) return;
  if (prefs[pref] === false) return;
  if (meeting[flag]) return;

  try {
    await sendMeetingReminderEmail({
      to:          user.email,
      userName:    user.fullName,
      title:       meeting.title,
      meetingTime: meeting.dateTime,
      type,
    });
    await Meeting.findByIdAndUpdate(meeting._id, {
      [flag]: true,
      reminderSent: true,
    });
    console.log(`[Reminder] ${type} → ${user.email} for "${meeting.title}"`);

    // Clear from retry queue on success
    const key = `${meeting._id}_${type}`;
    _retryQueue.delete(key);

  } catch (err) {
    console.error(`[Reminder] Failed ${type} for meeting ${meeting._id}:`, err.message);

    // Enqueue for retry
    const key = `${meeting._id}_${type}`;
    const entry = _retryQueue.get(key) || { meeting, user, type, attempt: 0 };
    entry.attempt += 1;

    if (entry.attempt >= MAX_RETRIES) {
      console.error(`[Reminder] Max retries reached for ${key}`);
      _retryQueue.delete(key);
      return;
    }

    entry.nextRetry = Date.now() + RETRY_BASE_MS * Math.pow(2, entry.attempt - 1);
    _retryQueue.set(key, entry);
    console.log(`[Reminder] Scheduled retry ${entry.attempt}/${MAX_RETRIES} for ${key}`);
  }
}

async function _processRetryQueue() {
  const now = Date.now();
  for (const [key, entry] of _retryQueue.entries()) {
    if (entry.nextRetry > now) continue;
    _retryQueue.delete(key);

    try {
      const meeting = await Meeting.findById(entry.meetingId).lean();
      if (!meeting) continue;
      const user = await User.findById(entry.user._id || entry.user).lean();
      if (!user) continue;
      await _sendIfNeeded(meeting, user, entry.type);
    } catch (err) {
      console.error(`[Reminder] Retry error for ${key}:`, err.message);
    }
  }
}

async function _tick() {
  try {
    const now  = new Date();
    const soon = new Date(now.getTime() + 35 * 60 * 1000);
    const past = new Date(now.getTime() - 5 * 60 * 1000);

    const meetings = await Meeting.find({
      completed: false,
      dateTime: { $lte: soon, $gte: past },
    }).lean();

    for (const meeting of meetings) {
      const user = await User.findById(meeting.user).lean();
      if (!user) continue;

      const msUntil = meeting.dateTime.getTime() - now.getTime();

      // Wider windows (±2 min instead of ±1) to reduce missed reminders
      if (Math.abs(msUntil) <= 2 * 60 * 1000) {
        await _sendIfNeeded(meeting, user, 'atStart');
      }
      if (msUntil >= 13 * 60 * 1000 && msUntil <= 17 * 60 * 1000) {
        await _sendIfNeeded(meeting, user, 'at15');
      }
      if (msUntil >= 28 * 60 * 1000 && msUntil <= 32 * 60 * 1000) {
        await _sendIfNeeded(meeting, user, 'at30');
      }
    }

    // Process retry queue
    await _processRetryQueue();

  } catch (err) {
    console.error('[Reminder] Tick error:', err.message);
  }
}

async function sendCreationReminder(meetingId) {
  try {
    const meeting = await Meeting.findById(meetingId).lean();
    if (!meeting) return;
    const user = await User.findById(meeting.user).lean();
    if (!user) return;
    await _sendIfNeeded(meeting, user, 'onCreate');
  } catch (err) {
    console.error('[Reminder] sendCreationReminder error:', err.message);
  }
}

function start() {
  if (_timer) return;
  _timer = setInterval(_tick, TICK_MS);
  console.log('[Reminder] Scheduler started (tick every 1 min)');
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

module.exports = { start, stop, sendCreationReminder };