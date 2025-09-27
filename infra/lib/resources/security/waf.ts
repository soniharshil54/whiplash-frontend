import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

export function associateWebAcl(
  scope: Construct,
  id: string,
  webAcl: wafv2.CfnWebACL,
  alb: elbv2.IApplicationLoadBalancer
) {
  const assoc = new wafv2.CfnWebACLAssociation(scope, id, {
    resourceArn: alb.loadBalancerArn,
    webAclArn: webAcl.attrArn,
  });
  assoc.addDependency(webAcl);
  return assoc;
}
