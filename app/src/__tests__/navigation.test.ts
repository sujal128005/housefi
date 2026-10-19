// "Back" on sign-in and registration screens: the previous screen, or the customer / technician choice when the screen
// was shown first (the launch gate would otherwise send people straight back to the same screen).
import { backOrStart, resetTo, START_HREF } from '../navigation';

// jest.mock is hoisted above the import, so the router is read lazily (variables used there must be named mock*).
const mockRouter = { canGoBack: jest.fn(), back: jest.fn(), replace: jest.fn(), canDismiss: jest.fn(), dismissAll: jest.fn() };
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));
const router = mockRouter;

beforeEach(() => jest.clearAllMocks());

describe('backOrStart', () => {
  it('goes back when there is a screen before', () => {
    router.canGoBack.mockReturnValue(true);
    backOrStart();
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('opens the customer / technician choice when the screen was shown first', () => {
    router.canGoBack.mockReturnValue(false);
    backOrStart();
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith(START_HREF);
    // Never the launch gate ("/"): it would send people straight back to the sign-in or registration screen.
    expect(START_HREF).toBe('/role');
  });
});

describe('resetTo', () => {
  it('clears the stack and shows one screen', () => {
    router.canDismiss.mockReturnValue(true);
    resetTo('/home');
    expect(router.dismissAll).toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/home');
  });
});
