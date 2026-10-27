/**
 * ==============================================================================
 * Silent SOS - Emergency Contacts Routes (`/api/v1/contacts`)
 * Description: Protected CRUD endpoints for managing trusted emergency contacts
 * with strict tenant isolation and transactional priority management.
 * ==============================================================================
 */

import { Router } from 'express';
import { getClient, query } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// All contact endpoints strictly require authentication
router.use(authenticateToken);

/**
 * Validates emergency contact payload
 */
function validateContactInput(
  { contact_name, contact_phone, contact_email, priority_order, notify_email, notify_sms },
  isUpdate = false
) {
  const errors = [];

  if (!isUpdate || contact_name !== undefined) {
    if (!contact_name || typeof contact_name !== 'string' || contact_name.trim().length < 1) {
      errors.push('contact_name is required and must not be empty.');
    } else if (contact_name.trim().length > 150) {
      errors.push('contact_name cannot exceed 150 characters.');
    }
  }

  // Communication method constraint: at least one of phone or email must be present
  const hasPhone = contact_phone && typeof contact_phone === 'string' && contact_phone.trim().length > 0;
  const hasEmail = contact_email && typeof contact_email === 'string' && contact_email.trim().length > 0;

  if (!isUpdate && !hasPhone && !hasEmail) {
    errors.push('At least one communication method (contact_phone or contact_email) must be provided.');
  }

  if (hasEmail && !EMAIL_REGEX.test(contact_email.trim())) {
    errors.push('Invalid contact_email format.');
  }

  if (priority_order !== undefined && priority_order !== null) {
    const priorityNum = Number(priority_order);
    if (!Number.isInteger(priorityNum) || priorityNum <= 0) {
      errors.push('priority_order must be a positive integer greater than 0.');
    }
  }

  if (notify_email !== undefined && typeof notify_email !== 'boolean') {
    errors.push('notify_email must be a boolean.');
  }

  if (notify_sms !== undefined && typeof notify_sms !== 'boolean') {
    errors.push('notify_sms must be a boolean.');
  }

  return errors;
}

/**
 * GET /api/v1/contacts
 * Retrieve all emergency contacts for the authenticated user ordered by priority
 */
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.id;

    const result = await query(
      `SELECT id, user_id, contact_name, contact_phone, contact_email, priority_order,
              notify_email, notify_sms, created_at, updated_at
       FROM emergency_contacts
       WHERE user_id = $1
       ORDER BY priority_order ASC;`,
      [userId]
    );

    return res.status(200).json({
      status: 'ok',
      data: {
        contacts: result.rows,
        count: result.rowCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/contacts
 * Create a new emergency contact for the authenticated user
 */
router.post('/', async (req, res, next) => {
  const client = await getClient();
  try {
    const userId = req.user.id;
    const { contact_name, contact_phone, contact_email, priority_order, notify_email, notify_sms } =
      req.body;

    const validationErrors = validateContactInput({
      contact_name,
      contact_phone,
      contact_email,
      priority_order,
      notify_email,
      notify_sms,
    });
    if (validationErrors.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors: validationErrors,
      });
    }

    const cleanName = contact_name.trim();
    const cleanPhone = contact_phone ? String(contact_phone).trim() : null;
    const cleanEmail = contact_email ? String(contact_email).trim().toLowerCase() : null;
    const wantsEmail = notify_email !== undefined ? notify_email : true;
    const wantsSms = notify_sms !== undefined ? notify_sms : true;

    await client.query('BEGIN');

    // Determine target priority
    let targetPriority;
    if (priority_order !== undefined && priority_order !== null) {
      targetPriority = parseInt(priority_order, 10);
    } else {
      const maxPriorityRes = await client.query(
        'SELECT COALESCE(MAX(priority_order), 0) AS max_priority FROM emergency_contacts WHERE user_id = $1;',
        [userId]
      );
      targetPriority = parseInt(maxPriorityRes.rows[0].max_priority, 10) + 1;
    }

    // Shift existing contacts with priority >= targetPriority upwards descending to avoid unique collisions
    const existingConflicts = await client.query(
      `SELECT id, priority_order FROM emergency_contacts 
       WHERE user_id = $1 AND priority_order >= $2 
       ORDER BY priority_order DESC;`,
      [userId, targetPriority]
    );

    for (const row of existingConflicts.rows) {
      await client.query(
        'UPDATE emergency_contacts SET priority_order = priority_order + 1, updated_at = NOW() WHERE id = $1;',
        [row.id]
      );
    }

    // Insert new contact
    const insertRes = await client.query(
      `INSERT INTO emergency_contacts (
         user_id, contact_name, contact_phone, contact_email, priority_order,
         notify_email, notify_sms, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING id, user_id, contact_name, contact_phone, contact_email, priority_order,
                 notify_email, notify_sms, created_at, updated_at;`,
      [userId, cleanName, cleanPhone, cleanEmail, targetPriority, wantsEmail, wantsSms]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      status: 'ok',
      message: 'Emergency contact added successfully.',
      data: {
        contact: insertRes.rows[0],
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/**
 * GET /api/v1/contacts/:id
 * Retrieve a specific contact by ID (strictly isolated to the authenticated user)
 */
router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const contactId = req.params.id;

    const result = await query(
      `SELECT id, user_id, contact_name, contact_phone, contact_email, priority_order,
              notify_email, notify_sms, created_at, updated_at
       FROM emergency_contacts
       WHERE id = $1 AND user_id = $2;`,
      [contactId, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Emergency contact not found.',
      });
    }

    return res.status(200).json({
      status: 'ok',
      data: {
        contact: result.rows[0],
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/contacts/:id
 * Update an existing emergency contact (strictly isolated to the authenticated user)
 */
router.put('/:id', async (req, res, next) => {
  const client = await getClient();
  try {
    const userId = req.user.id;
    const contactId = req.params.id;
    const { contact_name, contact_phone, contact_email, priority_order, notify_email, notify_sms } =
      req.body;

    const validationErrors = validateContactInput(
      { contact_name, contact_phone, contact_email, priority_order, notify_email, notify_sms },
      true
    );

    if (validationErrors.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors: validationErrors,
      });
    }

    await client.query('BEGIN');

    // Verify contact exists and belongs to current user
    const checkRes = await client.query(
      `SELECT id, user_id, contact_name, contact_phone, contact_email, priority_order,
              notify_email, notify_sms
       FROM emergency_contacts
       WHERE id = $1 AND user_id = $2;`,
      [contactId, userId]
    );

    if (checkRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        status: 'error',
        message: 'Emergency contact not found.',
      });
    }

    const currentContact = checkRes.rows[0];
    const newName = contact_name !== undefined ? contact_name.trim() : currentContact.contact_name;
    const newPhone = contact_phone !== undefined ? (contact_phone ? String(contact_phone).trim() : null) : currentContact.contact_phone;
    const newEmail = contact_email !== undefined ? (contact_email ? String(contact_email).trim().toLowerCase() : null) : currentContact.contact_email;
    const newNotifyEmail = notify_email !== undefined ? notify_email : currentContact.notify_email;
    const newNotifySms = notify_sms !== undefined ? notify_sms : currentContact.notify_sms;

    // Check communication method constraint
    if (!newPhone && !newEmail) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        status: 'error',
        message: 'At least one communication method (contact_phone or contact_email) must be maintained.',
      });
    }

    let newPriority = currentContact.priority_order;
    if (priority_order !== undefined && priority_order !== null) {
      const requestedPriority = parseInt(priority_order, 10);
      if (requestedPriority !== currentContact.priority_order) {
        // Handle priority reorganization
        // Temporarily set this contact's priority to 0 to avoid collision
        await client.query('UPDATE emergency_contacts SET priority_order = 0 WHERE id = $1;', [contactId]);

        if (requestedPriority > currentContact.priority_order) {
          // Shift intermediate contacts down: (old, new] -> -1
          const toShift = await client.query(
            `SELECT id FROM emergency_contacts 
             WHERE user_id = $1 AND priority_order > $2 AND priority_order <= $3 
             ORDER BY priority_order ASC;`,
            [userId, currentContact.priority_order, requestedPriority]
          );
          for (const row of toShift.rows) {
            await client.query('UPDATE emergency_contacts SET priority_order = priority_order - 1 WHERE id = $1;', [row.id]);
          }
        } else {
          // Shift intermediate contacts up: [new, old) -> +1
          const toShift = await client.query(
            `SELECT id FROM emergency_contacts 
             WHERE user_id = $1 AND priority_order >= $2 AND priority_order < $3 
             ORDER BY priority_order DESC;`,
            [userId, requestedPriority, currentContact.priority_order]
          );
          for (const row of toShift.rows) {
            await client.query('UPDATE emergency_contacts SET priority_order = priority_order + 1 WHERE id = $1;', [row.id]);
          }
        }
        newPriority = requestedPriority;
      }
    }

    // Update the contact record
    const updateRes = await client.query(
      `UPDATE emergency_contacts
       SET contact_name = $1,
           contact_phone = $2,
           contact_email = $3,
           priority_order = $4,
           notify_email = $5,
           notify_sms = $6,
           updated_at = NOW()
       WHERE id = $7 AND user_id = $8
       RETURNING id, user_id, contact_name, contact_phone, contact_email, priority_order,
                 notify_email, notify_sms, created_at, updated_at;`,
      [newName, newPhone, newEmail, newPriority, newNotifyEmail, newNotifySms, contactId, userId]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      status: 'ok',
      message: 'Emergency contact updated successfully.',
      data: {
        contact: updateRes.rows[0],
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/v1/contacts/:id
 * Delete an emergency contact and recompact priority ordering
 */
router.delete('/:id', async (req, res, next) => {
  const client = await getClient();
  try {
    const userId = req.user.id;
    const contactId = req.params.id;

    await client.query('BEGIN');

    const deleteRes = await client.query(
      'DELETE FROM emergency_contacts WHERE id = $1 AND user_id = $2 RETURNING id;',
      [contactId, userId]
    );

    if (deleteRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        status: 'error',
        message: 'Emergency contact not found.',
      });
    }

    // Recompact priority ordering (1, 2, 3...)
    const remainingRes = await client.query(
      `SELECT id FROM emergency_contacts 
       WHERE user_id = $1 
       ORDER BY priority_order ASC;`,
      [userId]
    );

    for (let i = 0; i < remainingRes.rows.length; i++) {
      const expectedPriority = i + 1;
      await client.query(
        'UPDATE emergency_contacts SET priority_order = $1 WHERE id = $2;',
        [expectedPriority, remainingRes.rows[i].id]
      );
    }

    await client.query('COMMIT');

    return res.status(200).json({
      status: 'ok',
      message: 'Emergency contact removed successfully.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

export default router;
