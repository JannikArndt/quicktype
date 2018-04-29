import { OrderedSet, is, hash } from "immutable";

import { UnionType, Type } from "./Type";
import { TypeAttributeKind } from "./TypeAttributes";
import { TypeRef } from "./TypeBuilder";
import { panic, hashCodeInit, addHashCode } from "./Support";
import { BaseGraphRewriteBuilder } from "./GraphRewriting";

export abstract class Transformer {
    abstract getChildren(): OrderedSet<Type>;

    abstract equals(other: any): boolean;
    abstract hashCode(): number;

    abstract reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer;
}

export class DecodingTransformer extends Transformer {
    constructor(
        readonly nullTransformer: Transformer | undefined,
        readonly integerTransformer: Transformer | undefined,
        readonly doubleTransformer: Transformer | undefined,
        readonly boolTransformer: Transformer | undefined,
        readonly stringTransformer: Transformer | undefined,
        readonly arrayTransformer: Transformer | undefined,
        readonly objectTransformer: Transformer | undefined
    ) {
        super();
    }

    getChildren(): OrderedSet<Type> {
        let children: OrderedSet<Type> = OrderedSet();
        if (this.nullTransformer !== undefined) {
            children = children.union(this.nullTransformer.getChildren());
        }
        if (this.integerTransformer !== undefined) {
            children = children.union(this.integerTransformer.getChildren());
        }
        if (this.doubleTransformer !== undefined) {
            children = children.union(this.doubleTransformer.getChildren());
        }
        if (this.boolTransformer !== undefined) {
            children = children.union(this.boolTransformer.getChildren());
        }
        if (this.stringTransformer !== undefined) {
            children = children.union(this.stringTransformer.getChildren());
        }
        if (this.arrayTransformer !== undefined) {
            children = children.union(this.arrayTransformer.getChildren());
        }
        if (this.objectTransformer !== undefined) {
            children = children.union(this.objectTransformer.getChildren());
        }
        return children;
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        function reconstitute(xf: Transformer | undefined) {
            if (xf === undefined) return undefined;
            return xf.reconstitute(builder);
        }

        return new DecodingTransformer(
            reconstitute(this.nullTransformer),
            reconstitute(this.integerTransformer),
            reconstitute(this.doubleTransformer),
            reconstitute(this.boolTransformer),
            reconstitute(this.stringTransformer),
            reconstitute(this.arrayTransformer),
            reconstitute(this.objectTransformer)
        );
    }

    equals(other: any): boolean {
        if (!(other instanceof DecodingTransformer)) return false;
        if (!is(this.nullTransformer, other.nullTransformer)) return false;
        if (!is(this.integerTransformer, other.integerTransformer)) return false;
        if (!is(this.doubleTransformer, other.doubleTransformer)) return false;
        if (!is(this.boolTransformer, other.boolTransformer)) return false;
        if (!is(this.stringTransformer, other.stringTransformer)) return false;
        if (!is(this.arrayTransformer, other.arrayTransformer)) return false;
        if (!is(this.objectTransformer, other.objectTransformer)) return false;
        return true;
    }

    hashCode(): number {
        let h = hashCodeInit;
        h = addHashCode(h, hash(this.nullTransformer));
        h = addHashCode(h, hash(this.integerTransformer));
        h = addHashCode(h, hash(this.doubleTransformer));
        h = addHashCode(h, hash(this.boolTransformer));
        h = addHashCode(h, hash(this.stringTransformer));
        h = addHashCode(h, hash(this.arrayTransformer));
        h = addHashCode(h, hash(this.objectTransformer));
        return h;
    }
}

export class UnionInstantiationTransformer extends Transformer {
    constructor(private readonly _unionRef: TypeRef) {
        super();
    }

    get unionType(): UnionType {
        const t = this._unionRef.deref()[0];
        if (!(t instanceof UnionType)) {
            return panic("Union instantiator with the wrong type");
        }
        return t;
    }

    getChildren(): OrderedSet<Type> {
        return OrderedSet([this.unionType]);
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new UnionInstantiationTransformer(builder.reconstituteTypeRef(this._unionRef));
    }

    equals(other: any): boolean {
        if (!(other instanceof UnionInstantiationTransformer)) return false;
        return this._unionRef.equals(other._unionRef);
    }

    hashCode(): number {
        return this._unionRef.hashCode();
    }
}

export class Transformation {
    constructor(private readonly _targetTypeRef: TypeRef, readonly transformer: Transformer) {}

    get targetType(): Type {
        return this._targetTypeRef.deref()[0];
    }

    getChildren(): OrderedSet<Type> {
        return this.transformer.getChildren().add(this.targetType);
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformation {
        return new Transformation(
            builder.reconstituteTypeRef(this._targetTypeRef),
            this.transformer.reconstitute(builder)
        );
    }

    equals(other: any): boolean {
        if (!(other instanceof Transformation)) return false;
        return this._targetTypeRef.equals(other._targetTypeRef) && this.transformer.equals(other.transformer);
    }

    hashCode(): number {
        let h = this._targetTypeRef.hashCode();
        h = addHashCode(h, this.transformer.hashCode());
        return h;
    }
}

class TransformationTypeAttributeKind extends TypeAttributeKind<Transformation> {
    constructor() {
        super("transformation");
    }

    get inIdentity(): boolean {
        return true;
    }

    children(xf: Transformation): OrderedSet<Type> {
        return xf.getChildren();
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder, xf: Transformation): Transformation {
        return xf.reconstitute(builder);
    }

    stringify(_: Transformation): string {
        return "transformation";
    }
}

export const transformationTypeAttributeKind: TypeAttributeKind<Transformation> = new TransformationTypeAttributeKind();

export function transformationForType(t: Type): Transformation | undefined {
    return transformationTypeAttributeKind.tryGetInAttributes(t.getAttributes());
}
