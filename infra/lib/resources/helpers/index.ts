import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

// helper: lookup CloudFront origin-facing prefix list id in THIS region
export function getCloudFrontPlId(scope: Construct, id: string) {
  const lookup = new cr.AwsCustomResource(scope, id, {
    onUpdate: {
      service: 'EC2',
      action: 'describeManagedPrefixLists',
      parameters: {
        Filters: [
          { Name: 'prefix-list-name', Values: ['com.amazonaws.global.cloudfront.origin-facing'] },
          { Name: 'owner-id', Values: ['AWS'] },
        ],
        MaxResults: 10,
      },
      // re-run on updates; static physical id is fine
      physicalResourceId: cr.PhysicalResourceId.of('CloudFrontPlLookupV1'),
    },
    policy: cr.AwsCustomResourcePolicy.fromStatements([
      new iam.PolicyStatement({
        actions: ['ec2:DescribeManagedPrefixLists'],
        resources: ['*'],
      }),
    ]),
  });

  // returns token like "pl-0abc123..."
  return lookup.getResponseField('PrefixLists.0.PrefixListId');
}
