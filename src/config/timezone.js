const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_TIMEZONE = 'UTC';

function getUserNow(tz) {
  return dayjs().tz(tz || DEFAULT_TIMEZONE);
}

function getUserToday(tz) {
  return getUserNow(tz).startOf('day');
}

function getUserTodayDate(tz) {
  const local = getUserNow(tz);
  return new Date(Date.UTC(local.year(), local.month(), local.date()));
}

function parseTimeInTz(timeStr, tz, dateStr) {
  const base = dateStr || getUserNow(tz).format('YYYY-MM-DD');
  return dayjs.tz(`${base} ${timeStr}`, 'YYYY-MM-DD HH:mm', tz || DEFAULT_TIMEZONE);
}

function isValidTimezone(tz) {
  if (!tz) return true;
  try {
    dayjs().tz(tz);
    return true;
  } catch {
    return false;
  }
}

function isValidTimeFormat(time) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(time);
}

function minutesBetween(start, end) {
  return Math.round(end.diff(start, 'minute', true));
}

module.exports = {
  dayjs,
  DEFAULT_TIMEZONE,
  getUserNow,
  getUserToday,
  getUserTodayDate,
  parseTimeInTz,
  isValidTimezone,
  isValidTimeFormat,
  minutesBetween,
};
