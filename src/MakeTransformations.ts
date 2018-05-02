import { Set } from "immutable";

import { TypeGraph } from "./TypeGraph";
import { TargetLanguage } from "./TargetLanguage";
import { UnionType, PrimitiveTypeKind } from "./Type";
import { GraphRewriteBuilder } from "./GraphRewriting";
import { TypeRef, StringTypeMapping } from "./TypeBuilder";
import { defined, assert } from "./Support";
import {
    UnionInstantiationTransformer,
    DecodingTransformer,
    Transformation,
    transformationTypeAttributeKind
} from "./Transformers";

function replace(
    setOfOneUnion: Set<UnionType>,
    builder: GraphRewriteBuilder<UnionType>,
    forwardingRef: TypeRef
): TypeRef {
    const union = defined(setOfOneUnion.first());
    assert(!union.members.isEmpty(), "We can't have empty unions");
    const reconstitutedUnion = builder.getUnionType(
        union.getAttributes(),
        union.members.map(m => builder.reconstituteType(m))
    );

    function transformerForKind(kind: PrimitiveTypeKind) {
        const member = union.findMember(kind);
        if (member === undefined) return undefined;
        return new UnionInstantiationTransformer(builder.reconstituteType(member), reconstitutedUnion);
    }

    const transformer = new DecodingTransformer(
        builder.getPrimitiveType("any"),
        transformerForKind("null"),
        transformerForKind("integer"),
        transformerForKind("double"),
        transformerForKind("bool"),
        transformerForKind("string"),
        undefined,
        undefined
    );
    const transformation = new Transformation(reconstitutedUnion, transformer);
    const attributes = transformationTypeAttributeKind.makeAttributes(transformation);
    return builder.getPrimitiveType("any", attributes, forwardingRef);
}

export function makeTransformations(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    targetLanguage: TargetLanguage,
    debugPrintReconstitution: boolean
): TypeGraph {
    const unions = graph
        .allTypesUnordered()
        .filter(t => t instanceof UnionType && targetLanguage.needsTransformerForUnion(t)) as Set<UnionType>;
    const groups = unions.toArray().map(t => [t]);
    return graph.rewrite("make-transformatios", stringTypeMapping, false, groups, debugPrintReconstitution, replace);
}
