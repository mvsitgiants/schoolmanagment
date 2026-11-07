import clsx from 'clsx'
import { PAGE } from './tokens'

/**
 * Standard operations-screen shell: page background, max width, vertical rhythm.
 * Every module screen's outermost element.
 *
 *   <PageContainer>
 *     <PageHeader ... />
 *     <StatCardRow ... />
 *     <Panel> ... </Panel>
 *   </PageContainer>
 */
export default function PageContainer({ children, wide = false, className }) {
  return (
    <div className={clsx(PAGE, wide && 'max-w-none', className)}>
      {children}
    </div>
  )
}
