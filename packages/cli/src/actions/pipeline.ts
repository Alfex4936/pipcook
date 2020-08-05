
import * as path from 'path';
import * as Url from 'url';
import { PipelineResp, PluginStatusValue } from '@pipcook/sdk';
import { constants, PluginStatus } from '@pipcook/pipcook-core';
import { readJson } from 'fs-extra';
import { install as pluginInstall } from './plugin';
import { logger, parseConfigFilename, initClient, streamToJson } from "../utils";
import { getFile } from '../request';

export async function list(opts: any): Promise<void> {
  const client = initClient(opts.host, opts.port);
  let pipelines = await client.pipeline.list();
  if (pipelines.length > 0) {
    console.table(pipelines, [ 'id', 'name', 'updatedAt', 'createdAt' ]);
  } else {
    console.info('no pipeline is created.');
  }
}

export async function info(id: string, opts: any): Promise<void> {
  const client = initClient(opts.host, opts.port);
  try {
    const pipeline = await client.pipeline.get(id);
    console.info(JSON.stringify(pipeline, null, 2));
  } catch (err) {
    logger.fail(err.message);
  }
}

export async function create(filename: string, opts: any): Promise<void> {
  const client = initClient(opts.host, opts.port);
  if (!path.isAbsolute(filename)) {
    filename = path.join(process.cwd(), filename);
  }
  const config = await readJson(filename);
  try {
    const pipeline = await client.pipeline.create(config, { name: opts.name });
    logger.success(`pipeline ${pipeline.id} created.`);
  } catch (err) {
    logger.fail(err.message);
  }
}

export async function update(id: string, filename: string, opts: any): Promise<void> {
  const client = initClient(opts.host, opts.port);
  if (!path.isAbsolute(filename)) {
    filename = path.join(process.cwd(), filename);
  }
  const config = await readJson(filename);
  try {
    const pipeline = await client.pipeline.update(id, config);
    logger.success(`pipeline ${pipeline.id} updated with ${filename}.`);
  } catch (err) {
    logger.fail(err.message);
  }
}

export async function remove(id: any, opts: any): Promise<void> {
  const client = initClient(opts.host, opts.port);
  try {
    if (id === 'all') {
      id = undefined;
    }
    await client.pipeline.remove(id);
    logger.success(id ? `pipeline ${id} has removed.` : `all pipelines removed.`);
  } catch (err) {
    logger.fail(err.message);
  }
}

export async function installPackageFromConfig(config: any, opts: any): Promise<void> {
  for (const plugin of constants.PLUGINS) {
    const packageName = config.plugins[plugin]?.package;
    if (typeof packageName === 'string') {
      if (packageName[0] === '.') {
        const pkg = await pluginInstall(packageName, opts);
        config.plugins[plugin].package = pkg.name;
      }
    }
  }
}

export async function install(filename: string, opts: any): Promise<void> {
  const client = initClient(opts.host, opts.port);
  logger.start(`start install pipeline from ${filename}`);
  try {
    filename = await parseConfigFilename(filename);
  } catch (err) {
    return logger.fail(err.message);
  }
  let pipeline: PipelineResp;
  try {
    if (filename.startsWith('file')) {
      const url = Url.parse(filename);
      const config = await readJson(url.path);
      logger.start('installing plugins');
      await installPackageFromConfig(config, opts);
      logger.info('start to create pipeline');
      pipeline = await client.pipeline.create(config);
      logger.success(`pipeline is created: ${pipeline.id}`);
    } else {
      logger.start(`downloading pipeline config file form ${filename}`);
      const stream = await getFile(filename);
      const config = await streamToJson(stream);
      logger.start('installing plugins');
      await installPackageFromConfig(config, opts);
      logger.info('start to create pipeline');
      pipeline = await client.pipeline.create(config);
      logger.success(`pipeline is created: ${pipeline.id}`);
    }
    // check the installation
    logger.info('check plugin:');
    let isSuccess = true;
    await constants.PLUGINS.forEach(async (plugin) => {
      if (!pipeline[plugin]) {
        return;
      }
      const plugins = await client.plugin.list({ name: pipeline[plugin] });
      if (plugins.length > 0) {
        if (plugins[0].status === PluginStatus.INSTALLED) {
          logger.success(`${pipeline[plugin]} installed.`);
        } else {
          isSuccess = false;
          logger.fail(`${pipeline[plugin]} ${PluginStatusValue[plugins[0].status]}.`, false);
        }
      }
    });
    if (isSuccess) {
      logger.success('pipeline installed successfully.');
    } else {
      logger.fail('pipeline installed field');
    }
  } catch (err) {
    logger.fail(`install pipeline error: ${err.message}`);
  }
}