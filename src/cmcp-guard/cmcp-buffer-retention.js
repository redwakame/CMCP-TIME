/** Normal Runtime policy. This does not expire History or change an existing activation. */
export function normalizeCmcpBufferRetention(value) {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => key !== 'hours'))) throw Error('invalid_buffer_retention');
  const hours = value?.hours === undefined ? 12 : value.hours;
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 6 || hours > 48
    || !Number.isSafeInteger(hours * 3600000)) throw Error('buffer_retention_hours_must_be_6_to_48');
  return Object.freeze({ hours, ttlMs: hours * 3600000, minimumHours: 6, maximumHours: 48, defaultHours: 12,
    source: value?.hours === undefined ? 'default' : 'configured', appliesTo: 'new_activations_only' });
}
