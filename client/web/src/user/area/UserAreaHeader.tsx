import React, { useMemo } from 'react'

import { NavLink } from 'react-router-dom'

import { UserAvatar } from '@sourcegraph/shared/src/components/UserAvatar'
import { Icon, PageHeader } from '@sourcegraph/wildcard'

import { BatchChangesProps } from '../../batches'
import { NavItemWithIconDescriptor } from '../../util/contributions'

import { UserAreaRouteContext } from './UserArea'

import styles from './UserAreaHeader.module.scss'

interface Props extends UserAreaRouteContext {
    navItems: readonly UserAreaHeaderNavItem[]
    className?: string
}

export interface UserAreaHeaderContext extends BatchChangesProps, Pick<Props, 'user'> {
    isSourcegraphDotCom: boolean
    isSourcegraphApp: boolean
}

export interface UserAreaHeaderNavItem extends NavItemWithIconDescriptor<UserAreaHeaderContext> {}

/**
 * Header for the user area.
 */
export const UserAreaHeader: React.FunctionComponent<React.PropsWithChildren<Props>> = ({
    url,
    navItems,
    className = '',
    ...props
}) => {
    /*
     * The path segment would always be recreated on rerenders, thus invalidating the loop over it in PageHeader.
     * As a result, the UserAvatar was always reinstanciated and rendered again, whenever the header rerenders
     * (every location change, for example). This prevents it from flickering.
     */
    const path = useMemo(
        () => ({
            text: (
                <span className="align-middle">
                    {props.user.displayName ? (
                        <>
                            {props.user.displayName} ({props.user.username})
                        </>
                    ) : (
                        props.user.username
                    )}
                </span>
            ),
            icon: () => <UserAvatar className={styles.avatar} user={props.user} />,
        }),
        [props.user]
    )

    return (
        <div className={className}>
            <div className="container">
                <PageHeader className="mb-3">
                    <PageHeader.Heading as="h2" styleAs="h1">
                        <PageHeader.Breadcrumb icon={path.icon}>{path.text}</PageHeader.Breadcrumb>
                    </PageHeader.Heading>
                </PageHeader>
                <nav className="d-flex align-items-end justify-content-between" aria-label="User">
                    <ul className="nav nav-tabs w-100">
                        {navItems.map(
                            ({ to, label, exact, icon: ItemIcon, condition = () => true }) =>
                                condition(props) && (
                                    <li key={label} className="nav-item">
                                        <NavLink to={url + to} className="nav-link">
                                            <span>
                                                {ItemIcon && <Icon as={ItemIcon} aria-hidden={true} />}{' '}
                                                <span className="text-content" data-tab-content={label}>
                                                    {label}
                                                </span>
                                            </span>
                                        </NavLink>
                                    </li>
                                )
                        )}
                    </ul>
                </nav>
            </div>
        </div>
    )
}
