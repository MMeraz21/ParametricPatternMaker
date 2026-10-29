import {
  isAccessorNode,
  isConditionalNode,
  isConstantNode,
  isFunctionNode,
  isOperatorNode,
  isParenthesisNode,
  isSymbolNode,
  parse,
  type MathNode
} from 'mathjs'

/**
 * Formulas are parsed with mathjs, then converted into our own small expression tree. Only a safe
 * subset is accepted (numbers, arithmetic, comparisons, ternaries, whitelisted functions, references),
 * so evaluation is sandboxed and always produces plain numbers.
 */

export type Axis = 'x' | 'y'

/** A reference from a formula to something else in the pattern. */
export type Reference =
  | { kind: 'symbol'; name: string }
  | { kind: 'pointCoord'; name: string; axis: Axis }

const FUNCTIONS = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  pow: Math.pow,
  exp: Math.exp,
  log: Math.log,
  min: Math.min,
  max: Math.max,
  hypot: Math.hypot,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  /** Degrees to radians. */
  rad: (deg: number) => (deg * Math.PI) / 180,
  /** Radians to degrees. */
  deg: (rad: number) => (rad * 180) / Math.PI
} satisfies Record<string, (...args: number[]) => number>
type FunctionName = keyof typeof FUNCTIONS

const CONSTANTS = {
  pi: Math.PI,
  tau: Math.PI * 2
} satisfies Record<string, number>
type ConstantName = keyof typeof CONSTANTS

const BINARY_OPERATORS = {
  '+': (a: number, b: number) => a + b,
  '-': (a: number, b: number) => a - b,
  '*': (a: number, b: number) => a * b,
  '/': (a: number, b: number) => a / b,
  '%': (a: number, b: number) => a % b,
  '^': (a: number, b: number) => a ** b,
  '<': (a: number, b: number) => Number(a < b),
  '>': (a: number, b: number) => Number(a > b),
  '<=': (a: number, b: number) => Number(a <= b),
  '>=': (a: number, b: number) => Number(a >= b),
  '==': (a: number, b: number) => Number(a === b),
  '!=': (a: number, b: number) => Number(a !== b)
} satisfies Record<string, (a: number, b: number) => number>
type BinaryOperator = keyof typeof BINARY_OPERATORS

const UNARY_OPERATORS = {
  '-': (a: number) => -a,
  '+': (a: number) => a
} satisfies Record<string, (a: number) => number>
type UnaryOperator = keyof typeof UNARY_OPERATORS

const isFunctionName = (name: string): name is FunctionName => Object.hasOwn(FUNCTIONS, name)
const isConstantName = (name: string): name is ConstantName => Object.hasOwn(CONSTANTS, name)
const isBinaryOperator = (op: string): op is BinaryOperator => Object.hasOwn(BINARY_OPERATORS, op)
const isUnaryOperator = (op: string): op is UnaryOperator => Object.hasOwn(UNARY_OPERATORS, op)

export type Expr =
  | { kind: 'number'; value: number }
  | { kind: 'ref'; ref: Reference }
  | { kind: 'call'; fn: FunctionName; args: Expr[] }
  | { kind: 'unary'; op: UnaryOperator; operand: Expr }
  | { kind: 'binary'; op: BinaryOperator; left: Expr; right: Expr }
  | { kind: 'conditional'; condition: Expr; whenTrue: Expr; whenFalse: Expr }

export interface CompiledFormula {
  source: string
  expr: Expr
  /** Unique references in order of first appearance. */
  references: Reference[]
}

export type CompileResult = { ok: true; formula: CompiledFormula } | { ok: false; message: string }

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Names that user items (measurements, variables, points) may not use. */
export function isReservedName(name: string): boolean {
  return isFunctionName(name) || isConstantName(name)
}

export function isValidName(name: string): boolean {
  return IDENTIFIER.test(name) && !isReservedName(name)
}

export function referenceKey(ref: Reference): string {
  return ref.kind === 'symbol' ? ref.name : `${ref.name}.${ref.axis}`
}

class UnsupportedSyntax extends Error {}

export function compileFormula(source: string): CompileResult {
  if (source.trim() === '') return { ok: false, message: 'Formula is empty' }

  let node: MathNode
  try {
    node = parse(source)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }

  let expr: Expr
  try {
    expr = toExpr(node)
  } catch (error) {
    if (error instanceof UnsupportedSyntax) return { ok: false, message: error.message }
    throw error
  }

  const references = new Map<string, Reference>()
  forEachReference(expr, (ref) => {
    const key = referenceKey(ref)
    if (!references.has(key)) references.set(key, ref)
  })

  return { ok: true, formula: { source, expr, references: [...references.values()] } }
}

function toExpr(node: MathNode): Expr {
  if (isParenthesisNode(node)) return toExpr(node.content)

  if (isConstantNode(node)) {
    if (typeof node.value !== 'number') throw new UnsupportedSyntax(`Unsupported literal: ${node.toString()}`)
    return { kind: 'number', value: node.value }
  }

  if (isSymbolNode(node)) {
    if (isConstantName(node.name)) return { kind: 'number', value: CONSTANTS[node.name] }
    if (isFunctionName(node.name)) {
      throw new UnsupportedSyntax(`'${node.name}' is a function; call it like ${node.name}(...)`)
    }
    return { kind: 'ref', ref: { kind: 'symbol', name: node.name } }
  }

  if (isAccessorNode(node)) {
    const [dimension, ...rest] = node.index.dimensions
    // mathjs types ConstantNode values as numbers, but property names in `A.x` are strings.
    const axis: unknown = dimension && isConstantNode(dimension) ? dimension.value : undefined
    if (!isSymbolNode(node.object) || rest.length > 0 || (axis !== 'x' && axis !== 'y')) {
      throw new UnsupportedSyntax(`Unsupported property access: ${node.toString()} (use Point.x or Point.y)`)
    }
    return { kind: 'ref', ref: { kind: 'pointCoord', name: node.object.name, axis } }
  }

  if (isFunctionNode(node)) {
    const name = node.fn.name
    if (!isFunctionName(name)) throw new UnsupportedSyntax(`Unknown function: ${name}`)
    return { kind: 'call', fn: name, args: node.args.map(toExpr) }
  }

  if (isOperatorNode(node)) {
    const [first, second, ...rest] = node.args
    if (first && !second && isUnaryOperator(node.op)) {
      return { kind: 'unary', op: node.op, operand: toExpr(first) }
    }
    if (first && second && rest.length === 0 && isBinaryOperator(node.op)) {
      return { kind: 'binary', op: node.op, left: toExpr(first), right: toExpr(second) }
    }
    throw new UnsupportedSyntax(`Unsupported operator: ${node.op}`)
  }

  if (isConditionalNode(node)) {
    return {
      kind: 'conditional',
      condition: toExpr(node.condition),
      whenTrue: toExpr(node.trueExpr),
      whenFalse: toExpr(node.falseExpr)
    }
  }

  throw new UnsupportedSyntax(`Unsupported expression: ${node.toString()}`)
}

function forEachReference(expr: Expr, visit: (ref: Reference) => void): void {
  switch (expr.kind) {
    case 'number':
      return
    case 'ref':
      return visit(expr.ref)
    case 'call':
      return expr.args.forEach((arg) => forEachReference(arg, visit))
    case 'unary':
      return forEachReference(expr.operand, visit)
    case 'binary':
      forEachReference(expr.left, visit)
      return forEachReference(expr.right, visit)
    case 'conditional':
      forEachReference(expr.condition, visit)
      forEachReference(expr.whenTrue, visit)
      return forEachReference(expr.whenFalse, visit)
    default: {
      const _exhaustive: never = expr
      return _exhaustive
    }
  }
}

/** Evaluate an expression. `resolve` must supply a value for every reference the expression contains. */
export function evaluateExpr(expr: Expr, resolve: (ref: Reference) => number): number {
  switch (expr.kind) {
    case 'number':
      return expr.value
    case 'ref':
      return resolve(expr.ref)
    case 'call': {
      const fn: (...args: number[]) => number = FUNCTIONS[expr.fn]
      return fn(...expr.args.map((arg) => evaluateExpr(arg, resolve)))
    }
    case 'unary':
      return UNARY_OPERATORS[expr.op](evaluateExpr(expr.operand, resolve))
    case 'binary':
      return BINARY_OPERATORS[expr.op](evaluateExpr(expr.left, resolve), evaluateExpr(expr.right, resolve))
    case 'conditional':
      return evaluateExpr(expr.condition, resolve) !== 0
        ? evaluateExpr(expr.whenTrue, resolve)
        : evaluateExpr(expr.whenFalse, resolve)
    default: {
      const _exhaustive: never = expr
      return _exhaustive
    }
  }
}
