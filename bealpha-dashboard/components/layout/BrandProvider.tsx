"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { brandCssTokens, DEFAULT_BRAND, TENANT_BRAND_UPDATED_EVENT, type TenantBrand } from "@/lib/tenant-brand";

const BrandContext = createContext<TenantBrand>(DEFAULT_BRAND);

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [brand, setBrand] = useState(DEFAULT_BRAND);

  useEffect(() => {
    let active = true;
    let latestRequest = 0;
    const loadBrand = () => {
      const request = ++latestRequest;
      apiRequest<TenantBrand>("/api/v1/catalog/tenant-brand")
        .then(value => { if (active && request === latestRequest) setBrand(value); })
        .catch(() => undefined);
    };
    window.addEventListener(TENANT_BRAND_UPDATED_EVENT, loadBrand);
    loadBrand();
    return () => {
      active = false;
      window.removeEventListener(TENANT_BRAND_UPDATED_EVENT, loadBrand);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const tokens = brandCssTokens(brand);
    for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
    document.title = `${brand.displayName} - Dashboard`;
    return () => {
      for (const name of Object.keys(tokens)) root.style.removeProperty(name);
      document.title = "BeAlpha Music - Dashboard";
    };
  }, [brand]);

  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useBrand(): TenantBrand {
  return useContext(BrandContext);
}
