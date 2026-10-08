const PRIVATE_RECEIVER_PERMISSION_SUFFIX='.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION';

const PROFILES=Object.freeze({
  android_founder_qa:Object.freeze({
    package_name:'com.knightshield.pentagon.mobiletest',
    min_version_code:28,
    version_name:/^2\.0\.\d+-test$/,
    min_sdk:24,
    min_target_sdk:35,
    main_activity:'com.knightshield.pentagon.MainActivity',
    callback:{scheme:'pentagon-customer-test',host:'login-callback'},
    allowed_permissions:(pkg)=>new Set(['android.permission.INTERNET',`${pkg}${PRIVATE_RECEIVER_PERMISSION_SUFFIX}`]),
    allowed_exported:(c)=>(
      (c.type==='activity'&&c.name==='com.knightshield.pentagon.MainActivity')||
      (c.type==='receiver'&&c.name==='androidx.profileinstaller.ProfileInstallReceiver'&&c.permission==='android.permission.DUMP')
    ),
    allowed_sensitive:new Set(),
  }),
  midnight_lens_android_founder_qa:Object.freeze({
    package_name:'com.knightshield.midnightlens.qa',
    min_version_code:2,
    version_name:/^0\.1\.\d+-qa\d+(?:-guided-proof)?$/,
    min_sdk:28,
    min_target_sdk:35,
    main_activity:'com.knightshield.midnightlens.qa.MainActivity',
    callback:null,
    allowed_permissions:()=>new Set(['android.permission.INTERNET','android.permission.CAMERA']),
    allowed_exported:(c)=>c.type==='activity'&&c.name==='com.knightshield.midnightlens.qa.MainActivity',
    allowed_sensitive:new Set(['android.permission.CAMERA']),
  }),
});

function result(reasons,findings){return{result:reasons.length?'FAIL':'PASS',reason_codes:reasons.length?reasons:['STATIC_POLICY_PASS'],findings};}
function componentByName(facts,name){return facts.components.find(c=>c.name===name);}
function profile(releaseClass){return PROFILES[releaseClass]??null;}

export function evaluateAndroidPackageIdentity(facts,releaseClass='android_founder_qa'){
  const p=profile(releaseClass),reasons=[];
  if(!p)return result(['UNSUPPORTED_RELEASE_CLASS'],{release_class:releaseClass});
  if(facts.package_name!==p.package_name)reasons.push('PACKAGE_NAME_MISMATCH');
  if(!Number.isInteger(facts.version_code)||facts.version_code<p.min_version_code)reasons.push('VERSION_CODE_INVALID');
  if(typeof facts.version_name!=='string'||!p.version_name.test(facts.version_name))reasons.push('VERSION_NAME_INVALID');
  if(!Number.isInteger(facts.target_sdk)||facts.target_sdk<p.min_target_sdk)reasons.push('TARGET_SDK_TOO_LOW');
  if(!Number.isInteger(facts.min_sdk)||facts.min_sdk<p.min_sdk)reasons.push('MIN_SDK_POLICY_MISMATCH');
  const main=componentByName(facts,p.main_activity);
  if(!main||main.type!=='activity'||main.exported!==true)reasons.push('MAIN_ACTIVITY_IDENTITY_INVALID');
  let callbackPresent=true;
  if(p.callback){
    callbackPresent=facts.data.some(x=>x.scheme===p.callback.scheme&&x.host===p.callback.host);
    if(!callbackPresent)reasons.push('AUTH_CALLBACK_IDENTITY_INVALID');
  }
  return result(reasons,{release_class:releaseClass,package_name:facts.package_name,version_code:facts.version_code,version_name:facts.version_name,target_sdk:facts.target_sdk,min_sdk:facts.min_sdk,main_activity:main??null,auth_callback_present:callbackPresent});
}

export function evaluateAndroidSecurityStatic(facts,releaseClass='android_founder_qa'){
  const p=profile(releaseClass),reasons=[];
  if(!p)return result(['UNSUPPORTED_RELEASE_CLASS'],{release_class:releaseClass});
  const allowed=p.allowed_permissions(p.package_name);
  const unexpected=facts.uses_permissions.filter(x=>!allowed.has(x));
  if(unexpected.length)reasons.push('UNEXPECTED_PERMISSION');
  if(!facts.uses_permissions.includes('android.permission.INTERNET'))reasons.push('INTERNET_PERMISSION_MISSING');
  if(facts.application.usesCleartextTraffic!==false)reasons.push('CLEARTEXT_DENY_NOT_EXPLICIT');
  const unsafe=facts.components.filter(c=>c.exported===true&&!p.allowed_exported(c)).map(c=>`${c.type}:${c.name??'unknown'}`);
  if(unsafe.length)reasons.push('UNSAFE_EXPORTED_COMPONENT');
  const providers=facts.components.filter(c=>c.type==='provider'&&c.exported===true);
  if(providers.length)reasons.push('EXPORTED_PROVIDER');
  return result(reasons,{release_class:releaseClass,permissions:facts.uses_permissions,unexpected_permissions:unexpected,uses_cleartext_traffic:facts.application.usesCleartextTraffic??null,unsafe_exported_components:unsafe,exported_provider_count:providers.length});
}

export function evaluateAndroidPrivacyStatic(facts,releaseClass='android_founder_qa'){
  const p=profile(releaseClass),reasons=[];
  if(!p)return result(['UNSUPPORTED_RELEASE_CLASS'],{release_class:releaseClass});
  if(facts.application.allowBackup!==false)reasons.push('BACKUP_NOT_DISABLED');
  if(typeof facts.application.dataExtractionRules!=='string'||!facts.application.dataExtractionRules.startsWith('@0x'))reasons.push('DATA_EXTRACTION_RULES_MISSING');
  if(typeof facts.application.fullBackupContent!=='string'||!facts.application.fullBackupContent.startsWith('@0x'))reasons.push('FULL_BACKUP_RULES_MISSING');
  const prefixes=['android.permission.CAMERA','android.permission.RECORD_AUDIO','android.permission.ACCESS_FINE_LOCATION','android.permission.ACCESS_COARSE_LOCATION','android.permission.READ_CONTACTS','android.permission.WRITE_CONTACTS','android.permission.READ_EXTERNAL_STORAGE','android.permission.WRITE_EXTERNAL_STORAGE','android.permission.READ_MEDIA_'];
  const sensitive=facts.uses_permissions.filter(x=>prefixes.some(prefix=>x.startsWith(prefix)));
  const unnecessary=sensitive.filter(x=>!p.allowed_sensitive.has(x));
  if(unnecessary.length)reasons.push('UNNECESSARY_SENSITIVE_PERMISSION');
  return result(reasons,{release_class:releaseClass,allow_backup:facts.application.allowBackup??null,data_extraction_rules:facts.application.dataExtractionRules??null,full_backup_content:facts.application.fullBackupContent??null,sensitive_permissions:sensitive,allowed_sensitive_permissions:[...p.allowed_sensitive],unnecessary_sensitive_permissions:unnecessary});
}
