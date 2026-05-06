import type { SpecData } from '../../types'
import type { ResolvedConstraint } from '../../data/selectors'
import { ConstraintCard } from './ConstraintCard'

interface Props {
  data: SpecData
  changed: ResolvedConstraint[]
  unchanged: ResolvedConstraint[]
}

export function ConstraintsSection({ data, changed, unchanged }: Props) {
  return (
    <>
      <div className="section">
        <h2>Changed Constraints ({changed.length})</h2>
        <div className="constraint-grid">
          {changed.map(c => (
            <ConstraintCard key={c.id} constraint={c} data={data} />
          ))}
        </div>
      </div>

      <details className="section unchanged-constraints">
        <summary>
          <h2>Unchanged Constraints ({unchanged.length})</h2>
        </summary>
        <div className="constraint-grid">
          {unchanged.map(c => (
            <ConstraintCard key={c.id} constraint={c} data={data} />
          ))}
        </div>
      </details>
    </>
  )
}
