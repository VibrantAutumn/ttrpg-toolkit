import { createContext, useContext } from "react";

export interface NavigationValue {
  /** Opens an item's page (from any tool). */
  openItem: (id: string) => void;
}

const NavigationContext = createContext<NavigationValue | null>(null);

export const NavigationProvider = NavigationContext.Provider;

export function useNavigation(): NavigationValue {
  const value = useContext(NavigationContext);
  if (!value) {
    throw new Error("useNavigation must be used inside NavigationProvider");
  }
  return value;
}
