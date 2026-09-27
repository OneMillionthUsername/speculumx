/** @jest-environment node */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockDb = {
  getPublishedPostsForHome: jest.fn(),
  getAllCategories: jest.fn(),
  getCardsPaginated: jest.fn(),
  getPublishedCardsCount: jest.fn(),
};

jest.unstable_mockModule('../databases/mariaDB.js', () => ({
  DatabaseService: mockDb,
}));

const { default: staticPageController } = await import('../controllers/staticPageController.js');

function createReq(query = {}) {
  return { ip: '127.0.0.1', query, get: () => undefined, csrfToken: () => 'token' };
}

function createRes() {
  const res = { locals: {} };
  res.set = jest.fn(() => res);
  res.status = jest.fn(() => res);
  res.render = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

describe('staticPageController.showHomePage', () => {
  beforeEach(() => {
    mockDb.getPublishedPostsForHome.mockResolvedValue([]);
    mockDb.getAllCategories.mockResolvedValue([]);
    mockDb.getCardsPaginated.mockResolvedValue([]);
    mockDb.getPublishedCardsCount.mockResolvedValue(0);
  });

  it('renders the home page when there are no published cards', async () => {
    const res = createRes();

    await staticPageController.showHomePage(createReq(), res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.render).toHaveBeenCalledWith('index', expect.objectContaining({ cards: [], cardsPagination: null }));
  });

  it('returns 404 for a cards page beyond the last one', async () => {
    const res = createRes();

    await staticPageController.showHomePage(createReq({ cardsPage: '2' }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith('notFound', expect.any(Object));
  });
});
