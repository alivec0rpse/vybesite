/*
 * Delivery modes and order statuses: the one list both the API and the two
 * pages read. The browser never hard-codes a label; /api/meta serves this file
 * to the admin page, and /api/track/{code} sends the labels it needs along
 * with the order.
 *
 * A mode's `flow` is the happy path the tracking page draws as a stepper. Any
 * status can still be set on any order — a courier parcel that ends up
 * collected from the office is real life — the flow only decides which steps
 * are drawn ahead of the current one.
 */

const STATUSES = {
  payment_confirmed: { label: 'Payment confirmed', hint: 'We have your payment and the order is booked.' },
  order_confirmed: { label: 'Order confirmed', hint: 'Your order is booked.' },
  processing: { label: 'Processing', hint: 'Your order is being prepared.' },
  packed: { label: 'Packed', hint: 'Packed and waiting to leave.' },
  ready_for_pickup: { label: 'Ready for pickup', hint: 'Ready to collect from our office.' },
  dispatched: { label: 'Dispatched', hint: 'Handed over for delivery.' },
  in_transit: { label: 'In transit', hint: 'On its way to your city.' },
  out_for_delivery: { label: 'Out for delivery', hint: 'Arriving today.' },
  delivered: { label: 'Delivered', hint: 'Delivered. Thank you for ordering with us.' },
  picked_up: { label: 'Collected', hint: 'Collected. Thank you for ordering with us.' },
  on_hold: { label: 'On hold', hint: 'Paused for now. We will be in touch.', exception: true },
  cancelled: { label: 'Cancelled', hint: 'This order was cancelled.', exception: true, final: true },
};

const BASE = ['payment_confirmed', 'processing', 'packed'];

const MODES = {
  hand_delivery: { label: 'Hand delivery', flow: [...BASE, 'out_for_delivery', 'delivered'] },
  courier: { label: 'Courier', flow: [...BASE, 'dispatched', 'in_transit', 'out_for_delivery', 'delivered'] },
  porter: { label: 'Porter', flow: [...BASE, 'dispatched', 'delivered'] },
  intracity: { label: 'Intracity delivery', flow: [...BASE, 'dispatched', 'out_for_delivery', 'delivered'] },
  pickup: { label: 'Pickup from office', flow: [...BASE, 'ready_for_pickup', 'picked_up'] },
  other: { label: 'Other', flow: [...BASE, 'dispatched', 'out_for_delivery', 'delivered'] },
};

/*
 * How the customer pays. A prepaid order opens at "Payment confirmed"; cash on
 * delivery and credit open at "Order confirmed" instead, because no money has
 * changed hands yet and the tracking page must not say it has.
 */
const PAYMENTS = {
  prepaid: { label: 'Prepaid' },
  cod: { label: 'Cash on delivery' },
  credit: { label: 'Credit (pay later)' },
};

/** The stepper for a mode and a payment type: the mode's path, opened by the right first step. */
const flowFor = (mode, payment) => {
  const flow = (MODES[mode] || MODES.other).flow.slice();
  if (payment === 'cod' || payment === 'credit') flow[0] = 'order_confirmed';
  return flow;
};

const firstStatus = (payment) => (payment === 'cod' || payment === 'credit' ? 'order_confirmed' : 'payment_confirmed');

const ROLES = ['user', 'admin'];

/** Statuses that close an order: nothing further is expected to happen. */
const isFinal = (status) => status === 'delivered' || status === 'picked_up' || status === 'cancelled';

module.exports = { STATUSES, MODES, PAYMENTS, ROLES, isFinal, flowFor, firstStatus };
