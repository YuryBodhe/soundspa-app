// 1. Глобальные настройки и утилиты (Фундамент)
export * from "./enums";
export * from "./utils";

// 2. CORE - Основные сущности (Родители)
export * from "./core/organizations";
export * from "./core/tenants";
export * from "./core/users";

// 3. CORE - Дополнения и связи (Зависят от Core)
export * from "./core/organization_members"; 
export * from "./core/auth";

// 4. PRODUCT - Контент и работа системы
export * from "./product/channels";
export * from "./product/tenant_channels"; 
export * from "./product/devices";
export * from "./product/monitoring";    

// 5. BILLING - Финансы
export * from "./billing/payments";
export * from "./billing/subscriptions";


// В будущем:
// export * from "./growth/referrals";
// export * from "./intelligence/agent_logs";