/**
 * InAppChannel — delivers notifications via Socket.IO to user-{userId} rooms.
 *
 * Delivery flow:
 *   1. Emit `notification:new` on the user's room.
 *   2. On ACK (if socket online) → mark delivered.
 *   3. If no socket connected → status stays 'queued_offline' (delivered on next poll/login).
 */
class InAppChannel {
  /**
   * @param {import('socket.io').Server} io - Socket.IO server instance
   */
  constructor(io) {
    this.io = io;
  }

  /**
   * Deliver a notification in-app via Socket.IO.
   *
   * @param {object} notification  - notification DB row
   * @param {object} content       - rendered content { title, body }
   * @returns {Promise<{success: boolean, messageId: string|null, delivered: boolean}>}
   */
  async deliver(notification, content) {
    const room = `user-${notification.user_id}`;

    const payload = {
      id:         notification.id,
      type:       notification.type,
      priority:   notification.priority,
      title:      content.title  || notification.title,
      body:       content.body   || notification.message,
      createdAt:  notification.created_at,
      channel:    'in_app',
    };

    if (!this.io) {
      // No Socket.IO instance — persist only
      console.log(`[InAppChannel] No Socket.IO instance — notification ${notification.id} stored only`);
      return { success: true, messageId: `inapp-${notification.id}`, delivered: false };
    }

    // Check if any socket is connected in this user's room
    const sockets = await this.io.in(room).fetchSockets();
    const online  = sockets.length > 0;

    if (online) {
      this.io.to(room).emit('notification:new', payload);

      // Also emit unread count refresh trigger
      this.io.to(room).emit('notification:unread-changed', { userId: notification.user_id });

      return {
        success:   true,
        messageId: `inapp-${notification.id}`,
        delivered: true,
      };
    }

    // User is offline — notification persisted in DB, will appear on next login
    console.log(`[InAppChannel] User ${notification.user_id} offline — notification ${notification.id} queued`);
    return {
      success:   true,
      messageId: `inapp-${notification.id}-offline`,
      delivered: false,
    };
  }
}

module.exports = InAppChannel;
