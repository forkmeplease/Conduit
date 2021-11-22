import React, { useEffect, useMemo, useState } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import Grid from '@material-ui/core/Grid';
import Typography from '@material-ui/core/Typography';
import { Container } from '@material-ui/core';
import Paper from '@material-ui/core/Paper';
import Box from '@material-ui/core/Box';

import Divider from '@material-ui/core/Divider';
import Button from '@material-ui/core/Button';
import { IStorageConfig } from '../../models/storage/StorageModels';

import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { FormInputSwitch } from '../common/FormComponents/FormInputSwitch';
import { FormInputSelect } from '../common/FormComponents/FormInputSelect';
import { FormInputText } from '../common/FormComponents/FormInputText';

const useStyles = makeStyles((theme) => ({
  paper: {
    padding: theme.spacing(2),
    color: theme.palette.text.secondary,
  },
  innerGrid: {
    paddingLeft: theme.spacing(4),
  },
  divider: {
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(2),
    width: '100%',
  },
  formControl: {
    minWidth: 250,
  },
  actions: {
    paddingTop: theme.spacing(3),
  },
}));

interface Props {
  config: IStorageConfig;
  handleSave: (data: IStorageConfig) => void;
}

interface FormProps {
  active: boolean;
  provider: string;
  google: {
    bucketName: string;
    serviceAccountKeyPath: string;
  };
  azure: { connectionString: string };
}

const StorageSettings: React.FC<Props> = ({ config, handleSave }) => {
  const [edit, setEdit] = useState<boolean>(false);
  const classes = useStyles();

  const methods = useForm<FormProps>({
    defaultValues: useMemo(() => {
      return {
        active: config.active,
        provider: config.provider,
        google: config.google,
        azure: config.azure,
      };
    }, [config]),
  });

  const { control, reset } = methods;

  useEffect(() => {
    reset(config);
  }, [config, reset]);

  const handleCancel = () => {
    setEdit(!edit);
    reset(config);
  };

  const isActive = useWatch({
    control,
    name: 'active',
  });

  const watchProvider = useWatch({
    control,
    name: 'provider',
  });

  const onSubmit = (data: FormProps) => {
    const dataToSave = {
      active: data.active,
      allowContainerCreation: true,
      defaultContainer: 'conduit',
      provider: data.provider,
      storagePath: '/var/tmp',
      google: data.google,
      azure: data.azure,
    };

    handleSave(dataToSave);
  };

  const handleEditClick = () => {
    setEdit(true);
  };

  const providers = [
    { name: 'Azure', value: 'azure' },
    { name: 'Google', value: 'google' },
  ];

  return (
    <Container>
      <Paper className={classes.paper}>
        <FormProvider {...methods}>
          <form onSubmit={methods.handleSubmit(onSubmit)}>
            <Grid container>
              <Box
                width={'100%'}
                display={'inline-flex'}
                justifyContent={'space-between'}
                alignItems={'center'}>
                <Typography variant={'h6'}>Activate Storage Module</Typography>
                <FormInputSwitch name={'active'} disabled={!edit} />
              </Box>
              <Divider className={classes.divider} />
              <Grid container spacing={2} className={classes.innerGrid}>
                {isActive && (
                  <>
                    <Grid item xs={12}>
                      <Typography variant={'h6'}>The provider to use for storage</Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <FormInputSelect
                        disabled={!edit}
                        label={'Provider'}
                        name="provider"
                        options={providers?.map((template) => ({
                          label: template.name,
                          value: template.value,
                        }))}
                      />
                    </Grid>
                    <Divider className={classes.divider} />
                    <Grid item spacing={1} container xs={12}>
                      {watchProvider === 'azure' ? (
                        <Grid item xs={6}>
                          <FormInputText
                            name="azure.connectionString"
                            label="Connection String"
                            disabled={!edit}
                          />
                        </Grid>
                      ) : (
                        <>
                          <Grid item xs={6}>
                            <FormInputText
                              name="google.serviceAccountKeyPath"
                              label="Service Account Key Path"
                              disabled={!edit}
                            />
                          </Grid>
                          <Grid item xs={6}>
                            <FormInputText
                              name="google.bucketName"
                              label="Bucket Name"
                              disabled={!edit}
                            />
                          </Grid>
                        </>
                      )}
                    </Grid>
                  </>
                )}
              </Grid>
              {edit && (
                <Grid item container xs={12} className={classes.actions} justify={'flex-end'}>
                  <Button
                    onClick={() => handleCancel()}
                    style={{ marginRight: 16 }}
                    color={'primary'}>
                    Cancel
                  </Button>
                  <Button
                    variant="contained"
                    color="primary"
                    style={{ alignSelf: 'flex-end' }}
                    type="submit">
                    Save
                  </Button>
                </Grid>
              )}
              {!edit && (
                <Grid item container xs={12} justify={'flex-end'}>
                  <Button
                    onClick={() => handleEditClick()}
                    style={{ marginRight: 16 }}
                    color={'primary'}>
                    Edit
                  </Button>
                </Grid>
              )}
            </Grid>
          </form>
        </FormProvider>
      </Paper>
    </Container>
  );
};

export default StorageSettings;
