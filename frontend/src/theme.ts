import type { ThemeConfig } from 'antd';

// SBOSS brand colours, taken from the logo's swoosh: raspberry pink into plum into deep indigo
export const BRAND = {
    pink: '#B62F58',
    plum: '#6D3266',
    indigo: '#2E2F69',
    primary: '#98325D', // buttons, links, the selected tab and menu item
    tint: '#F6E6EE', // the selected menu item's background
    hoverTint: '#FAF2F6',
    page: '#F7F5F9', // behind every page
    line: '#EEE6EC',
    gradient: 'linear-gradient(90deg, #B62F58 0%, #6D3266 55%, #2E2F69 100%)',
} as const;

// One place for the whole look: every screen picks these up. Status colours (red, green and so on) are left as they are.
export const theme: ThemeConfig = {
    token: {
        colorPrimary: BRAND.primary,
        colorInfo: BRAND.plum,
        colorLink: BRAND.primary,
        borderRadius: 8,
        colorBgLayout: BRAND.page,
    },
    components: {
        Layout: {
            siderBg: '#ffffff',
            bodyBg: BRAND.page,
            triggerBg: '#ffffff',
            triggerColor: BRAND.plum,
            headerPadding: '0 20px',
        },
        Menu: {
            itemBg: '#ffffff',
            subMenuItemBg: '#ffffff',
            itemSelectedBg: BRAND.tint,
            itemSelectedColor: BRAND.primary,
            itemHoverBg: BRAND.hoverTint,
            itemHoverColor: BRAND.primary,
            itemActiveBg: BRAND.tint,
            itemBorderRadius: 8,
            itemMarginInline: 8,
        },
    },
};