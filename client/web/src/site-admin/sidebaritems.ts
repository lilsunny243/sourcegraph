import AccountMultipleIcon from 'mdi-react/AccountMultipleIcon'
import ChartLineVariantIcon from 'mdi-react/ChartLineVariantIcon'
import CogsIcon from 'mdi-react/CogsIcon'
import ConsoleIcon from 'mdi-react/ConsoleIcon'
import MonitorStarIcon from 'mdi-react/MonitorStarIcon'
import SourceRepositoryIcon from 'mdi-react/SourceRepositoryIcon'

import { SiteAdminSideBarGroup, SiteAdminSideBarGroups } from './SiteAdminSidebar'

export const analyticsGroup: SiteAdminSideBarGroup = {
    header: {
        label: 'Analytics',
        icon: ChartLineVariantIcon,
    },
    items: [
        {
            label: 'Overview',
            to: '/site-admin/',
            exact: true,
        },
        {
            label: 'Search',
            to: '/site-admin/analytics/search',
        },
        {
            label: 'Code navigation',
            to: '/site-admin/analytics/code-intel',
        },
        {
            label: 'Users',
            to: '/site-admin/analytics/users',
        },
        {
            label: 'Insights',
            to: '/site-admin/analytics/code-insights',
        },
        {
            label: 'Batch changes',
            to: '/site-admin/analytics/batch-changes',
        },
        {
            label: 'Notebooks',
            to: '/site-admin/analytics/notebooks',
        },
        {
            label: 'Extensions',
            to: '/site-admin/analytics/extensions',
        },
        {
            label: 'Feedback survey',
            to: '/site-admin/surveys',
        },
    ],
}

export const configurationGroup: SiteAdminSideBarGroup = {
    header: {
        label: 'Configuration',
        icon: CogsIcon,
    },
    items: [
        {
            label: 'Site configuration',
            to: '/site-admin/configuration',
        },
        {
            label: 'Global settings',
            to: '/site-admin/global-settings',
        },
        {
            label: 'Feature flags',
            to: '/site-admin/feature-flags',
        },
    ],
}

export const repositoriesGroup: SiteAdminSideBarGroup = {
    header: {
        label: 'Repositories',
        icon: SourceRepositoryIcon,
    },
    items: [
        {
            label: 'Manage code hosts',
            to: '/site-admin/external-services',
        },
        {
            label: 'Repositories',
            to: '/site-admin/repositories',
        },
    ],
}

export const usersGroup: SiteAdminSideBarGroup = {
    header: {
        label: 'Users & auth',
        icon: AccountMultipleIcon,
    },
    items: [
        {
            label: 'Users',
            to: '/site-admin/users',
        },
        {
            label: 'Organizations',
            to: '/site-admin/organizations',
        },
        {
            label: 'Access tokens',
            to: '/site-admin/tokens',
        },
    ],
}

export const maintenanceGroupHeaderLabel = 'Maintenance'

export const maintenanceGroupMonitoringItemLabel = 'Monitoring'

export const maintenanceGroupInstrumentationItemLabel = 'Instrumentation'

export const maintenanceGroupUpdatesItemLabel = 'Updates'

export const maintenanceGroupMigrationsItemLabel = 'Migrations'

export const maintenanceGroupTracingItemLabel = 'Tracing'

export const maintenanceGroup: SiteAdminSideBarGroup = {
    header: {
        label: maintenanceGroupHeaderLabel,
        icon: MonitorStarIcon,
    },
    items: [
        {
            label: maintenanceGroupUpdatesItemLabel,
            to: '/site-admin/updates',
        },
        {
            label: 'Documentation',
            to: '/help',
        },
        {
            label: 'Pings',
            to: '/site-admin/pings',
        },
        {
            label: 'Report a bug',
            to: '/site-admin/report-bug',
        },
        {
            label: maintenanceGroupMigrationsItemLabel,
            to: '/site-admin/migrations',
        },
        {
            label: maintenanceGroupInstrumentationItemLabel,
            to: '/-/debug/',
            source: 'server',
        },
        {
            label: maintenanceGroupMonitoringItemLabel,
            to: '/-/debug/grafana',
            source: 'server',
        },
        {
            label: maintenanceGroupTracingItemLabel,
            to: '/-/debug/jaeger',
            source: 'server',
        },
        {
            label: 'Outbound requests',
            to: '/site-admin/outbound-requests',
            source: 'server',
        },
        {
            label: 'Slow Requests',
            to: '/site-admin/slow-requests',
            source: 'server',
        },
    ],
}

export const apiConsoleGroup: SiteAdminSideBarGroup = {
    header: {
        label: 'API Console',
        icon: ConsoleIcon,
    },
    items: [
        {
            label: 'API Console',
            to: '/api/console',
        },
    ],
}

export const siteAdminSidebarGroups: SiteAdminSideBarGroups = [
    analyticsGroup,
    configurationGroup,
    repositoriesGroup,
    usersGroup,
    maintenanceGroup,
    apiConsoleGroup,
]
