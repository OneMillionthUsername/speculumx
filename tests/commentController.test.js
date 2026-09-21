/** @jest-environment node */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockDb = {
  createComment: jest.fn(),
  getCommentsByPostId: jest.fn(),
  deleteComment: jest.fn(),
  getPostById: jest.fn(),
};
const mockSendMail = jest.fn();

jest.unstable_mockModule('../databases/mariaDB.js', () => ({
  DatabaseService: mockDb,
}));
jest.unstable_mockModule('../utils/logger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
jest.unstable_mockModule('../services/contactMailService.js', () => ({
  default: { sendCommentNotificationMail: mockSendMail },
}));
jest.unstable_mockModule('../utils/normalizers.js', () => ({
  normalizePublished: (v) => Boolean(v),
}));

const { default: commentController } = await import('../controllers/commentController.js');
const { CommentControllerException } = await import('../models/customExceptions.js');
const Comment = (await import('../models/commentModel.js')).default;

// Minimal valid comment body (createCommentRecord adds postId, created_at, etc.)
const makeBody = (overrides = {}) => ({
  text: 'This is a valid comment.',
  username: 'TestUser',
  ...overrides,
});

// Minimal valid comment row as returned from DB
const makeDbComment = (overrides = {}) => ({
  id: 1,
  text: 'This is a valid comment.',
  username: 'TestUser',
  approved: true,
  published: true,
  created_at: new Date('2025-01-01'),
  updated_at: new Date('2025-01-01'),
  ip_address: undefined,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSendMail.mockResolvedValue(undefined);
  mockDb.createComment.mockResolvedValue({ affectedRows: 1, comment: { text: 'x' } });
});

describe('commentController', () => {
  describe('createCommentRecord', () => {
    it('throws on Joi validation failure (empty text)', async () => {
      await expect(commentController.createCommentRecord(1, makeBody({ text: '' })))
        .rejects.toThrow(CommentControllerException);
    });

    it('throws on Joi validation failure (text too long)', async () => {
      await expect(commentController.createCommentRecord(1, makeBody({ text: 'x'.repeat(1001) })))
        .rejects.toThrow('Validation failed:');
    });

    it('stores the comment text raw (escaping happens at output)', async () => {
      await commentController.createCommentRecord(1, makeBody({ text: 'A "quoted" & <b>text</b>' }));
      const [, commentArg] = mockDb.createComment.mock.calls[0];
      expect(commentArg.text).toBe('A "quoted" & <b>text</b>');
    });

    it('defaults username to Anonym when empty', async () => {
      await commentController.createCommentRecord(1, makeBody({ username: '' }));
      // DB should have been called with Anonym (we can check via mock call args)
      const [, commentArg] = mockDb.createComment.mock.calls[0];
      expect(commentArg.username).toBe('Anonym');
    });

    it('stores the username raw but trimmed', async () => {
      await commentController.createCommentRecord(1, makeBody({ username: '  O\'Brien & Co  ' }));
      const [, commentArg] = mockDb.createComment.mock.calls[0];
      expect(commentArg.username).toBe('O\'Brien & Co');
    });

    it('throws when DB returns no affectedRows', async () => {
      mockDb.createComment.mockResolvedValue({ affectedRows: 0 });
      await expect(commentController.createCommentRecord(1, makeBody()))
        .rejects.toThrow('Failed to save comment to database');
    });

    it('throws when DB returns null', async () => {
      mockDb.createComment.mockResolvedValue(null);
      await expect(commentController.createCommentRecord(1, makeBody()))
        .rejects.toThrow('Failed to save comment to database');
    });

    it('returns the DB result on success', async () => {
      const dbResult = { affectedRows: 1, insertId: 42 };
      mockDb.createComment.mockResolvedValue(dbResult);
      const result = await commentController.createCommentRecord(1, makeBody());
      expect(result).toBe(dbResult);
    });
  });

  describe('fetchCommentsByPostId', () => {
    it('throws for invalid postId (NaN)', async () => {
      await expect(commentController.fetchCommentsByPostId(NaN))
        .rejects.toThrow('Invalid post ID provided');
    });

    it('throws for postId <= 0', async () => {
      await expect(commentController.fetchCommentsByPostId(0))
        .rejects.toThrow('Invalid post ID provided');
    });

    it('returns empty array when no comments exist', async () => {
      mockDb.getCommentsByPostId.mockResolvedValue([]);
      expect(await commentController.fetchCommentsByPostId(1)).toEqual([]);
    });

    it('returns Comment instances for valid published comments', async () => {
      mockDb.getCommentsByPostId.mockResolvedValue([makeDbComment()]);
      const result = await commentController.fetchCommentsByPostId(1);
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Comment);
    });

    it('skips unpublished comments', async () => {
      mockDb.getCommentsByPostId.mockResolvedValue([
        makeDbComment({ id: 1, published: true }),
        makeDbComment({ id: 2, published: false }),
      ]);
      const result = await commentController.fetchCommentsByPostId(1);
      expect(result).toHaveLength(1);
    });

    it('skips comments that fail Joi validation', async () => {
      mockDb.getCommentsByPostId.mockResolvedValue([
        makeDbComment(),
        { id: 2, text: '', published: true }, // fails: text min 1
      ]);
      const result = await commentController.fetchCommentsByPostId(1);
      expect(result).toHaveLength(1);
    });
  });

  describe('deleteCommentRecord', () => {
    it('throws for invalid commentId (NaN)', async () => {
      await expect(commentController.deleteCommentRecord(1, NaN))
        .rejects.toThrow('Invalid comment ID provided');
    });

    it('throws for commentId <= 0', async () => {
      await expect(commentController.deleteCommentRecord(1, 0))
        .rejects.toThrow('Invalid comment ID provided');
    });

    it('throws for invalid postId', async () => {
      await expect(commentController.deleteCommentRecord(0, 5))
        .rejects.toThrow('Invalid post ID provided');
    });

    it('throws when deletion fails', async () => {
      mockDb.deleteComment.mockResolvedValue({ success: false });
      await expect(commentController.deleteCommentRecord(1, 5))
        .rejects.toThrow('Comment not found or deletion failed');
    });

    it('returns the result on success', async () => {
      mockDb.deleteComment.mockResolvedValue({ success: true });
      const result = await commentController.deleteCommentRecord(1, 5);
      expect(result.success).toBe(true);
    });
  });
});
